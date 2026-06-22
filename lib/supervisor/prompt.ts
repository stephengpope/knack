import "server-only";
import type { UIMessage } from "ai";
import { getFileContents } from "@/lib/github";
import type { Project } from "@/lib/db/schema";
import type { ChecklistItem, TestCase } from "@/lib/board-types";

/** The card fields the supervisor judges against. */
export type CardContract = {
  title: string | null;
  iteration: number;
  userStory: string | null;
  details: string | null;
  acceptanceCriteria: ChecklistItem[];
  tasks: ChecklistItem[];
  testCases: TestCase[];
};

/**
 * Supervisor instructions, read from the project repo's SUPERVISOR.md. Missing
 * file → empty string (same as the other repo prompt files in build.ts); no
 * bundled-default fallback.
 */
export async function supervisorInstructions(
  project: Project | null,
  pat: string | null,
): Promise<string> {
  if (!project || !pat) return "";
  const body = await getFileContents(
    pat,
    project.repoOwner,
    project.repoName,
    "SUPERVISOR.md",
    project.defaultBranch,
  ).catch(() => null);
  return body ?? "";
}

function renderChecklist(items: ChecklistItem[]): string {
  if (!items.length) return "  (none specified)";
  return items.map((i) => `  - [${i.done ? "x" : " "}] ${i.text}`).join("\n");
}

function renderTests(items: TestCase[]): string {
  if (!items.length) return "  (none specified)";
  return items.map((t) => `  - ${t.desc} (${t.status})`).join("\n");
}

function renderContract(c: CardContract): string {
  return [
    "## The contract — what to achieve and how it's judged",
    `Title: ${c.title ?? "(untitled)"}`,
    "",
    "User story:",
    c.userStory?.trim() ? `  ${c.userStory.trim()}` : "  (none)",
    "",
    "Details:",
    c.details?.trim() ? `  ${c.details.trim()}` : "  (none)",
    "",
    "Tasks:",
    renderChecklist(c.tasks),
    "",
    "Acceptance criteria:",
    renderChecklist(c.acceptanceCriteria),
    "",
    "Test cases:",
    renderTests(c.testCases),
  ].join("\n");
}

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

/**
 * The worker's most recent text — the *claim* to verify, not evidence. Up to the
 * last 3 worker (assistant) text messages, oldest→newest, no tool I/O: the
 * supervisor checks the real repo with its own read-only tools, so the worker's
 * tool calls are noise here. Framed so the supervisor knows it's a tail, not the
 * full history.
 */
function renderRecentWork(messages: UIMessage[]): string {
  const texts = messages
    .filter((m) => m.role === "assistant")
    .map((m) =>
      (m.parts ?? [])
        .filter((p) => p.type === "text")
        .map((p) => (p as { text: string }).text)
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
  if (!texts.length) return "The worker hasn't started — nothing done yet.";

  const last = texts.slice(-3);
  const omitted = texts.length - last.length;
  const header =
    last.length === 1
      ? "The worker's latest message:"
      : `The worker's last ${last.length} messages, oldest first, newest last` +
        (omitted > 0
          ? ` (${omitted} earlier message${omitted > 1 ? "s" : ""} not shown — ` +
            `inspect the repo for the full state):`
          : ":");
  const body = last
    .map((t, i) => {
      const tag = i === last.length - 1 && last.length > 1 ? " (newest)" : "";
      const n = last.length > 1 ? `[${i + 1}${tag}]\n` : "";
      return `${n}${trunc(t, 2000)}`;
    })
    .join("\n\n---\n\n");
  return `${header}\n\n${body}`;
}

/**
 * The per-round message handed to the supervisor: the contract + the worker's
 * recent claim. The decision rules, loop framing, and nextPrompt guidance live
 * in the system prompt (SUPERVISOR.md), not here.
 */
export function renderRoundPrompt(c: CardContract, history: UIMessage[]): string {
  return [
    `# Round ${c.iteration}`,
    "",
    renderContract(c),
    "",
    "## Worker's latest",
    renderRecentWork(history),
    "",
    "Verify the repo against the contract and decide.",
  ].join("\n");
}
