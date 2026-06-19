import "server-only";
import type { Project } from "@/lib/db/schema";
import { getFileContents, listRepoDir } from "@/lib/github";
import { SKILLS_DIR } from "@/lib/prompt/paths";
import { MAX_DESCRIPTION } from "@/lib/skills/validate";

// A discovered skill's prompt-level metadata. Only name + description go into the
// prompt (the Agent Skills progressive-disclosure model); the full SKILL.md body
// loads on demand via the skill_load tool, by name.
export type Skill = {
  name: string;
  description: string;
};

/**
 * Discover a project's skills from its repo over the GitHub API. Lists `.skills/`,
 * reads each sub-folder's SKILL.md, and pulls the description (folder name is the
 * skill name, per the Agent Skills spec). Run once at chat creation — never touches
 * the sandbox. Flat `.skills/<name>/` only; nested folders are not scanned in v1.
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
      const description = extractDescription(body);
      if (!description) return null;
      return { name: dir.name, description };
    }),
  );

  return found.filter((s): s is Skill => s !== null);
}

/**
 * A skill's description for discovery: the frontmatter `description`, or the first
 * real body line as a fallback (matches hermes). Shared by the chat-creation scan
 * (scanSkills) and the live skills_list tool (skillsList).
 */
export function extractDescription(md: string): string | null {
  return parseDescription(md) ?? deriveDescriptionFromBody(md);
}

/** Frontmatter `description` (single-line value). Null if absent. */
function parseDescription(md: string): string | null {
  const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const line = fm[1].match(/^description:\s*(.+)$/m);
  if (!line) return null;
  const value = line[1].trim().replace(/^["']|["']$/g, "").trim();
  return value || null;
}

/** Fallback: the first non-empty, non-heading line of the body. */
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
