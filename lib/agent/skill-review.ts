import "server-only";
import { generateText, stepCountIs, type LanguageModel, type UIMessage } from "ai";
import type { SandboxBox } from "@/lib/sandbox/types";
import type { ResolvedModel } from "@/lib/llm";
import {
  fileReadTool,
  filesListTool,
  searchFilesTool,
  skillLoadTool,
  skillsListTool,
  skillManageTool,
} from "@/lib/agent/tools";
import { SKILL_REVIEW_PROMPT } from "@/lib/prompt/skill-review";

const MAX_REVIEW_STEPS = 16; // seatbelt; hermes caps its review fork at 16 too

/**
 * Render the conversation as plain text for the reviewer. The reviewer starts
 * with EMPTY history — the whole conversation goes inside one user message as
 * text (not replayed as structured messages), so there are no foreign tool-call
 * parts to validate and the reviewer holds only the tools we give it. The full
 * conversation is included verbatim (the same model just processed it in the
 * turn, so it fits) — no truncation.
 */
function renderTranscript(messages: UIMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    const label =
      m.role === "user" ? "USER" : m.role === "assistant" ? "ASSISTANT" : m.role.toUpperCase();
    for (const part of m.parts ?? []) {
      const type = (part as { type?: string }).type ?? "";
      if (type === "text") {
        const text = (part as { text?: string }).text ?? "";
        if (text.trim()) lines.push(`${label}: ${text}`);
      } else if (type === "reasoning") {
        // skip reasoning — not useful for the review and often large
      } else if (type.startsWith("tool-") || type === "dynamic-tool") {
        const p = part as { type: string; toolName?: string; input?: unknown; output?: unknown };
        const name = type === "dynamic-tool" ? (p.toolName ?? "tool") : type.slice("tool-".length);
        const input = p.input !== undefined ? JSON.stringify(p.input) : "";
        const output = p.output !== undefined ? JSON.stringify(p.output) : "";
        lines.push(`${label} called ${name}(${input})${output ? ` → ${output}` : ""}`);
      }
    }
  }
  return lines.join("\n");
}

export type ImprovementReviewResult = {
  ran: boolean;
  steps: number;
  skillActions: string[]; // human-readable summaries of successful skill writes
};

/**
 * The post-turn self-improvement review. Runs a SEPARATE, bounded agent loop
 * (not runAgentTurn — so no nested review) over the finished conversation, with
 * only skill tools + read-only investigation tools (composed from the shared
 * builders in lib/agent/tools.ts). Skill writes land in `box`; the caller's git
 * sync — sequenced strictly AFTER this returns — pushes them.
 *
 * Structured for both skills and memory; only `reviewSkills` is wired today.
 * Best-effort — callers should not let a throw here break the turn.
 */
export async function runImprovementReview(opts: {
  box: SandboxBox;
  messages: UIMessage[];
  model: LanguageModel;
  providerOptions?: ResolvedModel["providerOptions"];
  reviewSkills: boolean;
  reviewMemory?: boolean;
}): Promise<ImprovementReviewResult> {
  if (!opts.reviewSkills) return { ran: false, steps: 0, skillActions: [] };

  const transcript = renderTranscript(opts.messages);
  const boxRef = opts.box;
  const box = () => Promise.resolve(boxRef);
  const tools = {
    file_read: fileReadTool(box),
    files_list: filesListTool(box),
    search_files: searchFilesTool(box),
    skill_load: skillLoadTool(box),
    skills_list: skillsListTool(box),
    skill_manage: skillManageTool(box),
  };

  const skillActions: string[] = [];

  const result = await generateText({
    model: opts.model,
    providerOptions: opts.providerOptions,
    system:
      "You are a self-improvement reviewer. You read a finished conversation and " +
      "improve the agent's skill library so future sessions go better. You may " +
      "read and search the repo, but you may only make changes via skill tools.",
    messages: [
      {
        role: "user",
        content:
          "Here is the conversation to review:\n\n<conversation>\n" +
          transcript +
          "\n</conversation>\n\n" +
          SKILL_REVIEW_PROMPT,
      },
    ],
    tools,
    stopWhen: stepCountIs(MAX_REVIEW_STEPS),
    onStepFinish: ({ toolResults }) => {
      for (const r of toolResults ?? []) {
        if (r.toolName !== "skill_manage") continue;
        const out = r.output as { success?: boolean; message?: string } | undefined;
        if (out?.success && out.message) skillActions.push(out.message);
      }
    },
  });

  return { ran: true, steps: result.steps.length, skillActions };
}
