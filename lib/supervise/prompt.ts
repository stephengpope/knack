import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isToolUIPart, type UIMessage } from "ai";
import { getFileContents } from "@/lib/github";
import type { Project } from "@/lib/db/schema";
import type { ChecklistItem, TestCase } from "@/lib/board-types";

const DEFAULTS_DIR = path.join(process.cwd(), "lib", "prompt", "defaults");

/** The card fields the supervisor judges against. */
export type CardContract = {
  title: string | null;
  iteration: number;
  userStory: string | null;
  acceptanceCriteria: ChecklistItem[];
  definitionOfDone: ChecklistItem[];
  testCases: TestCase[];
};

/** Supervisor instructions: the repo's SUPERVISOR.md, else the bundled default. */
export async function supervisorInstructions(
  project: Project | null,
  pat: string | null,
): Promise<string> {
  if (project && pat) {
    try {
      const body = await getFileContents(
        pat,
        project.repoOwner,
        project.repoName,
        "SUPERVISOR.md",
        project.defaultBranch,
      );
      if (body && body.trim()) return body;
    } catch {
      // fall through to the bundled default
    }
  }
  return readFile(path.join(DEFAULTS_DIR, "DEFAULT_SUPERVISOR.md"), "utf8");
}

function renderChecklist(items: ChecklistItem[]): string {
  if (!items.length) return "  (none specified)";
  return items.map((i) => `  - [${i.done ? "x" : " "}] ${i.text}`).join("\n");
}

function renderTests(items: TestCase[]): string {
  if (!items.length) return "  (none specified)";
  return items.map((t) => `  - ${t.desc} (${t.status})`).join("\n");
}

export function renderContract(c: CardContract): string {
  return [
    "## Card contract",
    `Title: ${c.title ?? "(untitled)"}`,
    `Round: ${c.iteration}`,
    "",
    "User story:",
    c.userStory?.trim() ? `  ${c.userStory.trim()}` : "  (none)",
    "",
    "Acceptance criteria:",
    renderChecklist(c.acceptanceCriteria),
    "",
    "Definition of done:",
    renderChecklist(c.definitionOfDone),
    "",
    "Test cases:",
    renderTests(c.testCases),
  ].join("\n");
}

/**
 * Flatten the worker conversation to text for the supervisor's context. Tool
 * calls are included **faithfully** (name + input + output as text) — not as
 * native tool-call blocks, which would collide with the supervisor's own tool
 * schema/ids. The supervisor can also open the real files with its read tools.
 */
export function renderTranscript(messages: UIMessage[]): string {
  if (!messages.length) return "(no work yet — this is the first round)";
  const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);
  return messages
    .map((m) => {
      const body = (m.parts ?? [])
        .map((p): string | null => {
          if (p.type === "text") return p.text;
          if (p.type === "reasoning") return null; // internal; skip
          if (isToolUIPart(p)) {
            const tp = p as { type: string; input?: unknown; output?: unknown };
            const name = tp.type.replace(/^tool-/, "");
            const input = tp.input != null ? trunc(JSON.stringify(tp.input), 300) : "";
            const out = tp.output != null ? trunc(JSON.stringify(tp.output), 600) : "";
            return `[tool ${name}] ${input}${out ? ` → ${out}` : ""}`;
          }
          return null;
        })
        .filter((x): x is string => Boolean(x))
        .join("\n");
      return `${m.role.toUpperCase()}:\n${body || "(no text)"}`;
    })
    .join("\n\n");
}

export async function buildSupervisorSystem(
  contract: CardContract,
  project: Project | null,
  pat: string | null,
): Promise<string> {
  const instructions = await supervisorInstructions(project, pat);
  return `${instructions}\n\n${renderContract(contract)}`;
}
