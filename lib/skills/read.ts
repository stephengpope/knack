import "server-only";
import type { SandboxBox } from "@/lib/sandbox/types";
import { enumerateSkills, resolveSkillDir } from "@/lib/skills/resolve";
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
  const resolved = await resolveSkillDir(box, name);
  if (!resolved) return { error: `Skill '${name}' not found.` };
  const dir = resolved.dir;
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
    // Both roots (built-in $HOME/.skills + project .skills), any depth, deduped.
    const found = await enumerateSkills(box);
    return { skills: found.map(({ name, description }) => ({ name, description })) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
