import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Seed content for a new project repo. The bundled sources live as real .md
// under lib/prompt/defaults/ (named DEFAULT_<name>) and are read at runtime
// when a project is created. next.config's outputFileTracingIncludes guarantees
// they ship in the deployed bundle.
const DEFAULTS_DIR = path.join(process.cwd(), "lib", "prompt", "defaults");

// Every file seeded into a new repo, named as it appears in the repo. The
// bundled seed sources are DEFAULT_<name>. Which of these get injected into the
// system prompt, and in what order, is decided in build.ts — not here.
export const TEMPLATE_FILES = [
  "SOUL.md",
  "MEMORY.md",
  "USER.md",
  "AGENT.md",
  // Read by the supervisor each cycle (NOT injected into the worker prompt).
  "SUPERVISOR.md",
] as const;

// Seed files whose repo path can't be derived from a plain <name> (slashed
// paths, dotfiles). Each maps an explicit repo path to its DEFAULT_ source.
// `.attachments/.gitignore` is self-ignoring (`*` + `!.gitignore`): it keeps the
// per-chat attachments folder tracked in the repo while ignoring its contents.
const MAPPED_TEMPLATE_FILES: { path: string; source: string }[] = [
  { path: ".attachments/.gitignore", source: "DEFAULT_ATTACHMENTS_GITIGNORE" },
];

export type TemplateFile = { path: string; content: string };

/**
 * Read the bundled seed files (for creating a new repo). Sources are stored as
 * DEFAULT_<name> so they can't be confused with the live, per-project files;
 * the plain entries seed into the repo under their <name>, while the mapped
 * entries seed into an explicit repo path.
 */
export async function readTemplate(): Promise<TemplateFile[]> {
  return Promise.all([
    ...TEMPLATE_FILES.map(async (name) => ({
      path: name,
      content: await readFile(path.join(DEFAULTS_DIR, `DEFAULT_${name}`), "utf8"),
    })),
    ...MAPPED_TEMPLATE_FILES.map(async ({ path: repoPath, source }) => ({
      path: repoPath,
      content: await readFile(path.join(DEFAULTS_DIR, source), "utf8"),
    })),
  ]);
}
