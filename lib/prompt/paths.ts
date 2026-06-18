// The project repo is checked out at the sandbox root, which is also the agent's
// default working directory. Lives in its own module so prompt-building and
// sandbox code can share it without an import cycle.
export const REPO_DIR = "/vercel/sandbox";

// Convention dir (Agent Skills format) where a project's skills live, each as
// <name>/SKILL.md under it. Relative to the repo root.
export const SKILLS_DIR = ".skills";
