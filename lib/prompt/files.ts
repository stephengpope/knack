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
] as const;

export type TemplateFile = { path: string; content: string };

/**
 * Read the bundled seed files (for creating a new repo). Sources are stored as
 * DEFAULT_<name> so they can't be confused with the live, per-project files;
 * each seeds into the repo under its plain <name>.
 */
export async function readTemplate(): Promise<TemplateFile[]> {
  return Promise.all(
    TEMPLATE_FILES.map(async (name) => ({
      path: name,
      content: await readFile(path.join(DEFAULTS_DIR, `DEFAULT_${name}`), "utf8"),
    })),
  );
}
