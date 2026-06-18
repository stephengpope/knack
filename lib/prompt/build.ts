import "server-only";
import type { Project } from "@/lib/db/schema";
import { getFileContents } from "@/lib/github";
import { knackGuidance } from "@/lib/prompt/knack-guidance";
import { renderSkillsSection, type Skill } from "@/lib/prompt/skills";

// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL SYSTEM-PROMPT ORDER (source of truth — keep assembly below in sync)
//
//   1. SOUL.md          identity / persona                 (from repo)
//   2. KNACK_GUIDANCE   how Knack works: env, tools, skills (built-in code)
//   3. <available_skills>  this project's skills            (scanned at creation)
//   4. AGENT.md         project working playbook / rules    (from repo)
//   5. MEMORY.md        durable learned facts               (from repo)
//   6. USER.md          who the user is                     (from repo)
//
// Built once at chat creation and cached on the chat row; later turns reuse it.
// The whole prompt builds without a running sandbox — repo files come over the
// GitHub API, guidance from code, skills from the passed-in scan.
// ─────────────────────────────────────────────────────────────────────────────

// Repo files read from GitHub and injected into the prompt (arranged in the
// canonical order below, not in fetch order).
const REPO_FILES = ["SOUL.md", "AGENT.md", "MEMORY.md", "USER.md"] as const;

/** Wrap a section body in an XML-style tag, or "" when the body is empty. */
function section(tag: string, body: string): string {
  const trimmed = body.trim();
  return trimmed ? `<${tag}>\n${trimmed}\n</${tag}>` : "";
}

/**
 * Build the agent's system prompt in the canonical order above. A project is
 * required; without one (or without GitHub auth) there's no identity to load,
 * so this returns an empty prompt.
 */
export async function buildInstructions(
  project: Project | null,
  pat: string | null,
  skills: Skill[] = [],
): Promise<string> {
  if (!project || !pat) return "";

  // Fetch the repo files in parallel (missing ones become "" — no fallback
  // content), keyed by name so ordering is controlled here, not by the fetch.
  const fetched = await Promise.all(
    REPO_FILES.map((file) =>
      getFileContents(
        pat,
        project.repoOwner,
        project.repoName,
        file,
        project.defaultBranch,
      )
        .catch(() => null)
        .then((body) => [file, body ?? ""] as const),
    ),
  );
  const repo = new Map(fetched);

  const parts = [
    section("SOUL.md", repo.get("SOUL.md") ?? ""),
    knackGuidance(project),
    renderSkillsSection(skills),
    section("AGENT.md", repo.get("AGENT.md") ?? ""),
    section("MEMORY.md", repo.get("MEMORY.md") ?? ""),
    section("USER.md", repo.get("USER.md") ?? ""),
  ];

  return parts.filter(Boolean).join("\n\n");
}
