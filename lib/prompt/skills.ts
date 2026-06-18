import "server-only";
import type { Project } from "@/lib/db/schema";
import { getFileContents, listRepoDir } from "@/lib/github";
import { SKILLS_DIR } from "@/lib/prompt/paths";

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
      const description = parseDescription(body);
      if (!description) return null; // spec: description is required
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
 * Render the `<available_skills>` section for the system prompt. Returns "" when
 * there are no skills. Lists name + description only — the model loads a skill's
 * full instructions by calling the load_skill tool with its name.
 */
export function renderSkillsSection(skills: Skill[]): string {
  if (skills.length === 0) return "";

  const lines = [
    "The following skills provide specialized instructions for specific tasks.",
    "When a task matches a skill's description, call the load_skill tool with " +
      "its name to load the full instructions, then follow them.",
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
