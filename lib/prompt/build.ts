import "server-only";
import type { Project } from "@/lib/db/schema";
import { getFileContents } from "@/lib/github";
import { knackGuidance } from "@/lib/prompt/knack-guidance";
import { renderSkillsSection } from "@/lib/skills/render";
import type { Skill } from "@/lib/skills/discover";
import { BUILTIN_SKILLS } from "@/lib/sandbox/provision";

// Built-in tooling skills (agent-browser, firecrawl-*) are baked into every box's
// $HOME/.skills by the snapshot build. Their name+description are hard-coded here
// because the prompt is assembled server-side with no sandbox to scan. They take
// precedence over project skills on a name clash.
function mergeBuiltins(projectSkills: Skill[]): Skill[] {
  const builtins: Skill[] = BUILTIN_SKILLS.map((s) => ({
    name: s.name,
    description: s.description,
  }));
  const taken = new Set(builtins.map((s) => s.name));
  return [...builtins, ...projectSkills.filter((s) => !taken.has(s.name))];
}

// ─────────────────────────────────────────────────────────────────────────────
// CANONICAL SYSTEM-PROMPT ORDER (source of truth — keep assembly below in sync)
//
//   1. SOUL.md          identity / persona                 (from repo)
//   2. KNACK_GUIDANCE   how Knack works: env, tools, skills (built-in code)
//   3. <available_skills>  this project's skills            (scanned at creation)
//   4. AGENT.md         project working playbook / rules    (from repo)
//   5. MEMORY.md        durable learned facts               (from repo)
//   6. USER.md          who the user is                     (from repo)
//   7. Conversation started: <date>  (date-only, dead last)  (built-in code)
//
// Built once at chat creation and cached on the chat row; later turns reuse it.
// The whole prompt builds without a running sandbox — repo files come over the
// GitHub API, guidance from code, skills from the passed-in scan.
// ─────────────────────────────────────────────────────────────────────────────

// Repo files read from GitHub and injected into the prompt (arranged in the
// canonical order below, not in fetch order).
const REPO_FILES = ["SOUL.md", "AGENT.md", "MEMORY.md", "USER.md"] as const;

/**
 * Build the agent's system prompt in the canonical order above. A project is
 * required; without one (or without GitHub auth) there's no identity to load,
 * so this returns an empty prompt.
 */
export async function buildInstructions(
  project: Project | null,
  pat: string | null,
  skills: Skill[] = [],
  timezone = "UTC",
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

  // Each repo file already starts with its own markdown header (# Soul, # Agent,
  // …), so they're injected raw and separated by blank lines — no wrapper tags.
  const parts = [
    (repo.get("SOUL.md") ?? "").trim(),
    knackGuidance(project),
    renderSkillsSection(mergeBuiltins(skills)),
    (repo.get("AGENT.md") ?? "").trim(),
    (repo.get("MEMORY.md") ?? "").trim(),
    (repo.get("USER.md") ?? "").trim(),
    // Dead last. Date-only (no time) so the frozen prompt is byte-stable for the
    // whole day — keeps upstream prompt caches warm across turns. Rendered in the
    // user's timezone (defaults to UTC) since the server runs in UTC.
    `Conversation started: ${new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: timezone,
    })}`,
  ];

  return parts.filter(Boolean).join("\n\n");
}
