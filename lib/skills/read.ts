import "server-only";
import type { SandboxBox } from "@/lib/sandbox/types";
import { REPO_DIR, SKILLS_DIR } from "@/lib/prompt/paths";
import { extractDescription } from "@/lib/skills/discover";
import { validateSkillName } from "@/lib/skills/validate";

/** Result of skill_load: the SKILL.md body + its bundled files, or one file. */
export type SkillLoadResult =
  | { name: string; instructions: string; files: string[] }
  | { name: string; file: string; content: string }
  | { error: string };

/**
 * skill_load: load a skill's SKILL.md (and list its bundled files), or load one
 * bundled file when `file` is given. Reads from the sandbox where the repo is
 * checked out.
 */
export async function skillLoad(
  box: SandboxBox,
  name: string,
  file?: string,
): Promise<SkillLoadResult> {
  const nameErr = validateSkillName(name);
  if (nameErr) return { error: nameErr };
  const dir = `${REPO_DIR}/${SKILLS_DIR}/${name}`;
  try {
    if (file) {
      if (file.includes("..") || !/^[A-Za-z0-9._/-]+$/.test(file)) {
        return { error: `Invalid file path "${file}".` };
      }
      return { name, file, content: await box.readFile(`${dir}/${file}`) };
    }
    const instructions = await box.readFile(`${dir}/SKILL.md`);
    const ls = await box.run("bash", [
      "-c",
      `cd '${dir}' && find . -type f ! -name SKILL.md | sed 's|^\\./||' | sort`,
    ]);
    const files = ls.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    return { name, instructions, files };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * skills_list: list the project's skills (name + description), read live from the
 * sandbox `.skills/`. Reflects skills created/edited this chat, which the frozen
 * <available_skills> prompt block does not.
 */
export async function skillsList(
  box: SandboxBox,
): Promise<{ skills: { name: string; description: string }[] } | { error: string }> {
  try {
    const root = `${REPO_DIR}/${SKILLS_DIR}`;
    const ls = await box.run("bash", [
      "-c",
      `find '${root}' -maxdepth 2 -name SKILL.md 2>/dev/null | sort`,
    ]);
    const paths = ls.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const skills: { name: string; description: string }[] = [];
    for (const p of paths) {
      const md = await box.readFile(p).catch(() => null);
      if (!md) continue;
      const description = extractDescription(md);
      const m = p.match(/\/([^/]+)\/SKILL\.md$/);
      if (description && m) skills.push({ name: m[1], description });
    }
    return { skills };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
