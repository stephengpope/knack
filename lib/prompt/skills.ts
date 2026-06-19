import "server-only";
import type { Project } from "@/lib/db/schema";
import { getFileContents, listRepoDir } from "@/lib/github";
import { SKILLS_DIR } from "@/lib/prompt/paths";
import { MAX_DESCRIPTION } from "@/lib/skills/validate";

// A discovered skill's prompt-level metadata. Only name + description go into
// the prompt (the Agent Skills progressive-disclosure model). The full SKILL.md
// body loads on demand when the model calls the load_skill tool with the name —
// so we don't need to carry a path here; it's derived by convention.
export type Skill = {
  name: string;
  description: string;
};

/**
 * Discover a project's skills from its repo over the GitHub API. Lists
 * `.skills/`, reads each sub-folder's SKILL.md, and pulls the `description` from
 * its frontmatter (the folder name is the skill name, per the Agent Skills
 * spec). Run once at chat creation — never touches the sandbox. Flat
 * `.skills/<name>/` only; nested folders are not scanned in v1.
 */
export async function scanSkills(
  pat: string,
  project: Project,
): Promise<Skill[]> {
  const entries = await listRepoDir(
    pat,
    project.repoOwner,
    project.repoName,
    SKILLS_DIR,
    project.defaultBranch,
  );
  const dirs = entries.filter((e) => e.type === "dir");

  const found = await Promise.all(
    dirs.map(async (dir) => {
      const body = await getFileContents(
        pat,
        project.repoOwner,
        project.repoName,
        `${SKILLS_DIR}/${dir.name}/SKILL.md`,
        project.defaultBranch,
      ).catch(() => null);
      if (!body) return null;
      // Prefer the frontmatter description; fall back to the first real body
      // line so a skill without one still shows up (matches hermes discovery).
      const description = parseDescription(body) ?? deriveDescriptionFromBody(body);
      if (!description) return null;
      return { name: dir.name, description };
    }),
  );

  return found.filter((s): s is Skill => s !== null);
}

/**
 * Pull the `description` from a SKILL.md's YAML frontmatter. Minimal by design —
 * single-line values only (multi-line YAML is out of scope for v1). Returns null
 * if there's no frontmatter or no description.
 */
function parseDescription(md: string): string | null {
  const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const line = fm[1].match(/^description:\s*(.+)$/m);
  if (!line) return null;
  const value = line[1].trim().replace(/^["']|["']$/g, "").trim();
  return value || null;
}

/**
 * Fallback description: the first non-empty, non-heading line of the body (after
 * any frontmatter). Used only for discovery when frontmatter has no description.
 */
function deriveDescriptionFromBody(md: string): string | null {
  const fm = md.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/);
  const body = fm ? md.slice(fm[0].length) : md;
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (t && !t.startsWith("#")) {
      return t.length > MAX_DESCRIPTION ? t.slice(0, MAX_DESCRIPTION - 3) + "..." : t;
    }
  }
  return null;
}

/**
 * Render the `<available_skills>` section for the system prompt. Returns "" when
 * there are no skills. Lists name + description only — the model loads a skill's
 * full instructions by calling the load_skill tool with its name.
 */
export function renderSkillsSection(skills: Skill[]): string {
  if (skills.length === 0) return "";

  const lines = [
    "## Skills (mandatory)",
    "Before replying, scan the skills below. If a skill matches — or is even " +
      "partially relevant to — the task, you MUST load it with load_skill(name) " +
      "and follow its instructions. Err on the side of loading: it is better to " +
      "have context you don't need than to miss critical steps or pitfalls. " +
      "Skills encode specialized, proven workflows and the user's preferred " +
      "approach — load them even for tasks you think you could handle with basic " +
      "tools.",
    "",
    "<available_skills>",
  ];
  for (const s of skills) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(s.name)}</name>`);
    lines.push(`    <description>${escapeXml(s.description)}</description>`);
    lines.push("  </skill>");
  }
  lines.push("</available_skills>");
  lines.push("");
  lines.push("Only proceed without loading a skill if genuinely none are relevant.");
  return lines.join("\n");
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
