import "server-only";
import type { Project } from "@/lib/db/schema";
import { getFileContents, getTree } from "@/lib/github";
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
 * Discover a project's skills from its repo over the GitHub API. Resolves the
 * `.skills/` tree then recurses it in one call, so organizational subfolders at
 * any depth are found. A skill's identity is its LEAF folder name (Agent Skills
 * spec: name = parent dir, single segment); on a leaf-name collision the first
 * one wins (matches hermes/pi — never errors). Run once at chat creation — never
 * touches the sandbox.
 */
export async function scanSkills(
  pat: string,
  project: Project,
): Promise<Skill[]> {
  const { repoOwner: owner, repoName: repo, defaultBranch: branch } = project;

  const root = await getTree(pat, owner, repo, branch, false);
  const skillsEntry = root.tree.find(
    (e) => e.path === SKILLS_DIR && e.type === "tree",
  );
  if (!skillsEntry) return [];

  const sub = await getTree(pat, owner, repo, skillsEntry.sha, true);
  // Paths are relative to `.skills/`. A skill manifest is `<…>/SKILL.md` with at
  // least one folder above it (a bare `.skills/SKILL.md` has no name → skip).
  const manifests = sub.tree.filter(
    (e) => e.type === "blob" && e.path.endsWith("/SKILL.md"),
  );

  const fetched = await Promise.all(
    manifests.map(async (m) => {
      const body = await getFileContents(
        pat,
        owner,
        repo,
        `${SKILLS_DIR}/${m.path}`,
        branch,
      ).catch(() => null);
      return { path: m.path, body };
    }),
  );

  const seen = new Set<string>();
  const out: Skill[] = [];
  for (const { path, body } of fetched) {
    if (!body) continue;
    const parts = path.split("/");
    const name = parts[parts.length - 2]; // leaf folder = name
    if (!name || seen.has(name)) continue;
    const description = extractDescription(body);
    if (!description) continue;
    seen.add(name);
    out.push({ name, description });
  }
  return out;
}

/**
 * A skill's description for discovery: the frontmatter `description`, or the first
 * real body line as a fallback (matches hermes). Shared by the chat-creation scan
 * (scanSkills) and the live skills_list tool (skillsList).
 */
export function extractDescription(md: string): string | null {
  return parseDescription(md) ?? deriveDescriptionFromBody(md);
}

/**
 * Frontmatter `description`. Handles both a single-line value and a YAML block
 * scalar (`description: |` / `>`, with optional chomp/indent indicators) — the
 * latter is common in vendor skills (e.g. firecrawl-*). Multi-line bodies are
 * flattened to a single line for the prompt. Null if absent.
 */
function parseDescription(md: string): string | null {
  const fmMatch = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return null;
  const lines = fmMatch[1].split(/\r?\n/);
  const i = lines.findIndex((l) => /^description:/.test(l));
  if (i < 0) return null;
  const head = lines[i].replace(/^description:\s*/, "").trim();

  // Block scalar: collect the following more-indented lines until a dedent.
  if (/^[|>][+-]?\d*$/.test(head)) {
    const out: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === "") continue;
      if (/^\s/.test(l)) out.push(l.trim());
      else break; // dedent → next frontmatter key
    }
    const value = out.join(" ").replace(/\s+/g, " ").trim();
    return value || null;
  }

  const value = head.replace(/^["']|["']$/g, "").trim();
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
