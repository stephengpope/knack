import "server-only";
import {
  streamText,
  tool,
  Output,
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
import { resolveAgentModel } from "@/lib/llm";
import { VercelSandbox } from "@/lib/sandbox/vercel";
import { REPO_DIR } from "@/lib/prompt/paths";
import { cloneUrlWithToken } from "@/lib/github";
import { fileRead } from "@/lib/files/read";
import { searchFiles } from "@/lib/files/search";
import { getGithubAuth } from "@/lib/github-account";

const checklistItem = z.object({ text: z.string(), done: z.boolean() });
const testCase = z.object({
  desc: z.string(),
  status: z.enum(["idle", "running", "pass", "fail"]),
});

const decisionSchema = z.object({
  verdict: z.enum(["continue", "review", "blocked"]),
  reason: z.string(),
  nextPrompt: z.string().nullable(),
  criteriaUpdates: z.object({
    acceptanceCriteria: z.array(checklistItem).nullable(),
    definitionOfDone: z.array(checklistItem).nullable(),
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

  const tools = {
    file_read: tool({
      description:
        "Read a text file (read-only). Use to verify the worker's output.",
      inputSchema: z.object({
        path: z.string(),
        offset: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(2000).default(500),
      }),
      execute: async ({ path, offset, limit }) =>
        fileRead(await box(), path, offset, limit),
    }),
    files_list: tool({
      description: "List a directory's immediate contents (read-only).",
      inputSchema: z.object({ path: z.string().default(".") }),
      execute: async ({ path }) => {
        try {
          return { listing: await (await box()).listDir(path) };
        } catch (e) {
          return { error: (e as Error).message };
        }
      },
    }),
    search_files: tool({
      description:
        "Search the codebase (read-only). Regex over file contents, or a glob to find files.",
      inputSchema: z.object({
        pattern: z.string(),
        target: z.enum(["content", "files"]).default("content"),
        path: z.string().default("."),
        file_glob: z.string().optional(),
        output_mode: z
          .enum(["content", "files_only", "count"])
          .default("content"),
        context: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).default(50),
        offset: z.number().int().min(0).default(0),
      }),
      execute: async (a) => searchFiles(await box(), a),
    }),
  };

  const result = streamText({
    model,
    providerOptions,
    system,
    messages: llmMessages,
    tools,
    stopWhen: stepCountIs(12),
    experimental_output: Output.object({ schema: decisionSchema }),
  });

  // Persist the supervisor's turn (reasoning + tool calls) to its chat. We store
  // a light round marker as the user message (not the big worker-convo dump that
  // went to the LLM), then the streamed assistant turn.
  const round = prior.filter((m) => m.role === "user").length + 1;
  const marker: UIMessage = {
    id: createIdGenerator({ prefix: "msg", size: 16 })(),
    role: "user",
    parts: [{ type: "text", text: `Round ${round} — reviewing the worker's latest work.` }],
  };

  const uiStream = createUIMessageStream({
    originalMessages: [...prior, marker],
    generateId: createIdGenerator({ prefix: "msg", size: 16 }),
    onFinish: async ({ messages }) => {
      await saveMessages(supervisorChatId, messages as UIMessage[]);
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

  const decision = await result.output;
  const usage = await result.totalUsage;

  // Append the decision as a final part so the popup can render a decision card
  // and the drawer can read the latest verdict. Reload + re-save the full list
  // (saveMessages reindexes by position).
  const after = await loadMessages(supervisorChatId);
  const last = after[after.length - 1];
  if (last && last.role === "assistant") {
    (last.parts as unknown[]).push({
      type: "data-decision",
      data: {
        verdict: decision.verdict,
        reason: decision.reason,
        nextPrompt: decision.nextPrompt,
      },
    });
    await saveMessages(supervisorChatId, after);
  }

  return {
    decision,
    modelId,
    usage: {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    },
  };
}
