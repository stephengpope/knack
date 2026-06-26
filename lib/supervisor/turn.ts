import "server-only";
import {
  streamText,
  generateObject,
  stepCountIs,
  convertToModelMessages,
  createUIMessageStream,
  createIdGenerator,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { chat, type Project } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { loadMessages, saveMessages } from "@/lib/chats";
import { drainStream } from "@/lib/agent/run-turn";
import { fileReadTool, filesListTool, searchFilesTool } from "@/lib/agent/tools";
import { resolveAgentModel } from "@/lib/llm";
import { VercelSandbox } from "@/lib/sandbox/vercel";
import { REPO_DIR } from "@/lib/prompt/paths";
import { cloneUrlWithToken } from "@/lib/github";
import { getGithubAuth } from "@/lib/github-account";

const checklistItem = z.object({ text: z.string(), done: z.boolean() });
const testCase = z.object({
  desc: z.string(),
  status: z.enum(["idle", "running", "pass", "fail"]),
});

const decisionSchema = z.object({
  // continue: more work/planning needed → nextPrompt drives the worker.
  // review: execution done to standard → hand to a human (in_progress only).
  // approve: the PLAN is sound → start execution (plan status only).
  // blocked: genuinely stuck → needs a human.
  verdict: z.enum(["continue", "review", "approve", "blocked"]),
  reason: z.string(),
  nextPrompt: z.string().nullable(),
  criteriaUpdates: z.object({
    acceptanceCriteria: z.array(checklistItem).nullable(),
    tasks: z.array(checklistItem).nullable(),
    testCases: z.array(testCase).nullable(),
  }),
});

export type SupervisorDecision = z.infer<typeof decisionSchema>;
export type TurnUsage = { inputTokens: number; outputTokens: number };

export type SupervisorTurnResult = {
  decision: SupervisorDecision;
  modelId: string;
  usage: TurnUsage;
};

/** The full decision rendered for the supervisor log — every field, readably. */
function renderDecision(d: SupervisorDecision): string {
  const lines = [`**Decision: ${d.verdict}**`, "", `Reason: ${d.reason || "(none)"}`];
  if (d.verdict === "continue") {
    lines.push(
      "",
      "Next prompt (sent to the worker verbatim):",
      d.nextPrompt?.trim() || "(empty)",
    );
  }
  const cu = d.criteriaUpdates;
  const list = (items: { text: string; done: boolean }[]) =>
    items.map((i) => `[${i.done ? "x" : " "}] ${i.text}`).join("; ") || "(empty)";
  const cuLines: string[] = [];
  if (cu.tasks) cuLines.push(`  Tasks → ${list(cu.tasks)}`);
  if (cu.acceptanceCriteria)
    cuLines.push(`  Acceptance criteria → ${list(cu.acceptanceCriteria)}`);
  if (cu.testCases)
    cuLines.push(
      `  Test cases → ${cu.testCases.map((t) => `${t.desc} (${t.status})`).join("; ") || "(empty)"}`,
    );
  if (cuLines.length) lines.push("", "Criteria updates:", ...cuLines);
  return lines.join("\n");
}

/**
 * One supervisor review turn. Mirrors `runAgentTurn`'s care (own copy of the
 * box checkout) but is read-only: it inspects the WORKER's box, persists its
 * own reasoning + tool calls + decision to the SUPERVISOR chat, and returns the
 * structured decision. Non-streamed to a client (drained server-side).
 */
export async function runSupervisorTurn(params: {
  userId: string;
  supervisorChatId: string;
  workerChatId: string;
  project: Project | null;
  githubAuth: Awaited<ReturnType<typeof getGithubAuth>>;
  /** The per-round prompt: contract + full worker conversation as text. */
  roundPrompt: string;
}): Promise<SupervisorTurnResult> {
  const { supervisorChatId, workerChatId, project, githubAuth, roundPrompt } =
    params;

  const { modelId, model, providerOptions } = await resolveAgentModel();

  // Frozen SUPERVISOR.md system prompt (set at supervisor-chat creation).
  const [row] = await db
    .select({ systemPrompt: chat.systemPrompt })
    .from(chat)
    .where(eq(chat.id, supervisorChatId))
    .limit(1);
  const system = row?.systemPrompt ?? "You are the supervisor.";

  // The supervisor's own prior turns (its memory) + this round's user message.
  const prior = await loadMessages(supervisorChatId);
  const llmMessages = [
    ...(await convertToModelMessages(prior)),
    { role: "user" as const, content: roundPrompt },
  ];

  // Read-only tools on the WORKER's box (so it sees the worker's repo state).
  let repoChecked = false;
  const sandbox = new VercelSandbox();
  async function box() {
    const b = await sandbox.getOrCreate(workerChatId);
    if (project && githubAuth && !repoChecked) {
      const check = await b.run("bash", [
        "-c",
        `test -d ${REPO_DIR}/.git && echo ok || echo no`,
      ]);
      if (check.stdout.trim() !== "ok") {
        const url = cloneUrlWithToken(
          githubAuth.pat,
          project.repoOwner,
          project.repoName,
        );
        const branch = JSON.stringify(project.defaultBranch);
        await b.run("bash", [
          "-c",
          `cd ${REPO_DIR} && git init -q -b ${branch} && ` +
            `git remote add origin ${url} && ` +
            `git fetch -q --depth=1 origin ${project.defaultBranch} && ` +
            `git reset -q --hard origin/${project.defaultBranch}`,
        ]);
      }
      repoChecked = true;
    }
    return b;
  }

  // Read-only subset, composed from the shared tool builders (lib/agent/tools.ts).
  // The supervisor only inspects the worker's box — no write/bash tools.
  const tools = {
    file_read: fileReadTool(box),
    files_list: filesListTool(box),
    search_files: searchFilesTool(box),
  };

  // ── Phase 1: VERIFY ──────────────────────────────────────────────────────
  // Free-form: the supervisor inspects the worker's repo with read-only tools and
  // writes its findings as text. No structured output here, so nothing collides
  // with the model's reasoning stream (the cause of the old garbled JSON).
  const genId = createIdGenerator({ prefix: "msg", size: 16 });
  const result = streamText({
    model,
    providerOptions,
    system,
    messages: llmMessages,
    tools,
    stopWhen: stepCountIs(12),
  });

  // Persist the REAL turn: the prompt the supervisor received + its actual reply
  // (reasoning text + tool calls). Captured here; saved once after the decision
  // so the log holds the complete round (verification + decision).
  const userMsg: UIMessage = {
    id: genId(),
    role: "user",
    parts: [{ type: "text", text: roundPrompt }],
  };

  let verifyMessages: UIMessage[] = [...prior, userMsg];
  const uiStream = createUIMessageStream({
    originalMessages: [...prior, userMsg],
    generateId: genId,
    onFinish: ({ messages }) => {
      verifyMessages = messages as UIMessage[];
    },
    execute: ({ writer }) => {
      writer.merge(
        result.toUIMessageStream() as unknown as Parameters<
          typeof writer.merge
        >[0],
      );
    },
  });
  await drainStream(uiStream as ReadableStream<unknown>);

  const findings = (await result.text).trim();
  const usage1 = await result.totalUsage;

  // ── Phase 2: DECIDE ──────────────────────────────────────────────────────
  // A separate, forced call: generateObject MUST return a valid decision (no
  // "did it remember to call the tool?"). No tools, thinking disabled — Anthropic
  // forbids forced tool-choice (object mode) while thinking is on, and the model
  // already did its reasoning in phase 1.
  const decisionRes = await generateObject({
    model,
    providerOptions: {
      ...(providerOptions ?? {}),
      anthropic: { thinking: { type: "disabled" } },
    },
    schema: decisionSchema,
    system,
    prompt:
      `${roundPrompt}\n\n## Your verification findings\n` +
      `${findings || "(no findings recorded)"}\n\n` +
      `Return your decision as the structured object.`,
  });
  const decision = decisionRes.object;
  const usage2 = decisionRes.usage;

  // The complete decision, rendered readably, appended as the round's final entry.
  const decisionMsg: UIMessage = {
    id: genId(),
    role: "assistant",
    parts: [{ type: "text", text: renderDecision(decision) }],
  };
  await saveMessages(supervisorChatId, [...verifyMessages, decisionMsg]);

  return {
    decision,
    modelId,
    usage: {
      inputTokens: (usage1.inputTokens ?? 0) + (usage2.inputTokens ?? 0),
      outputTokens: (usage1.outputTokens ?? 0) + (usage2.outputTokens ?? 0),
    },
  };
}
