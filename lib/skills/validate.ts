import "server-only";

// Limits, mirrored from hermes (skill_manager_tool.py) and the agentskills.io spec.
export const MAX_NAME = 64;
export const MAX_DESCRIPTION = 1024;
export const MAX_SKILL_CONTENT = 100_000; // chars, SKILL.md body
export const MAX_FILE_BYTES = 1_048_576; // 1 MiB, supporting files
export const FILE_SUBDIRS = ["references", "templates", "scripts", "assets"] as const;

// Agent Skills spec name rule: 1-64 chars, lowercase a-z/0-9 and single hyphens,
// no leading/trailing or consecutive hyphens. (Stricter than hermes, which also
// allows dots/underscores — we follow the spec for portability across tools.)
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Supporting-file paths: an allowed subdir + a safe relative path. The charset
// also keeps the value safe to interpolate into a shell command.
const FILE_PATH_RE = /^[A-Za-z0-9._/-]+$/;

export function validateSkillName(name: string): string | null {
  if (!name) return "Skill name is required.";
  if (name.length > MAX_NAME) return `Skill name exceeds ${MAX_NAME} characters.`;
  if (!NAME_RE.test(name)) {
    return (
      "Invalid skill name. Use lowercase letters, numbers, and single hyphens " +
      "(e.g. 'pdf-tools') — no leading/trailing or doubled hyphens, no spaces."
    );
  }
  return null;
}

export type FrontmatterResult = {
  error: string | null;
  name?: string;
  description?: string;
};

/**
 * Validate a SKILL.md string: YAML frontmatter delimited by `---`, with a
 * non-empty `name` and `description`, followed by a non-empty body. Returns the
 * parsed name/description on success. Minimal single-line value parsing (multi-
 * line YAML descriptions are out of scope, same as our discovery scanner).
 */
export function validateFrontmatter(content: string): FrontmatterResult {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n/);
  if (!m) return { error: "SKILL.md must start with YAML frontmatter delimited by '---'." };
  const fm = m[1];
  const nameLine = fm.match(/^name:\s*(.+)$/m);
  const descLine = fm.match(/^description:\s*(.+)$/m);
  const name = nameLine ? unquote(nameLine[1]) : "";
  const description = descLine ? unquote(descLine[1]) : "";

  if (!name) return { error: "Frontmatter must include a 'name'." };
  if (!description) return { error: "Frontmatter must include a non-empty 'description'." };
  if (description.length > MAX_DESCRIPTION) {
    return { error: `description exceeds ${MAX_DESCRIPTION} characters.` };
  }
  const body = content.slice(m[0].length).trim();
  if (!body) return { error: "SKILL.md must have instructions in the body after the frontmatter." };
  return { error: null, name, description };
}

export function validateContentSize(content: string, label = "SKILL.md"): string | null {
  if (content.length > MAX_SKILL_CONTENT) {
    return `${label} exceeds ${MAX_SKILL_CONTENT} characters.`;
  }
  return null;
}

export function validateFilePath(filePath: string): string | null {
  if (!filePath) return "file_path is required.";
  if (filePath.includes("..")) return "file_path must not contain '..'.";
  if (!FILE_PATH_RE.test(filePath)) {
    return "file_path contains invalid characters.";
  }
  const top = filePath.split("/")[0];
  if (!FILE_SUBDIRS.includes(top as (typeof FILE_SUBDIRS)[number])) {
    return `file_path must be under one of: ${FILE_SUBDIRS.join(", ")}/`;
  }
  return null;
}

function unquote(s: string): string {
  return s.trim().replace(/^["']|["']$/g, "").trim();
}
