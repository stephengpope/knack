import "server-only";
import type { SandboxBox } from "@/lib/sandbox/types";
import { REPO_DIR, SKILLS_DIR } from "@/lib/prompt/paths";
import { extractDescription } from "@/lib/skills/discover";

// Skills live in two roots inside the box:
//  - BUILTIN_ROOT: vendored tooling skills baked into the snapshot ($HOME/.skills),
//    outside the repo so git never sees them. Read-only to the agent.
//  - PROJECT_ROOT: the project's own skills in the checked-out repo (.skills),
//    editable, and now discoverable at any depth (organizational subfolders).
// A skill's identity is its LEAF folder name (Agent Skills spec: name = parent
// dir, single segment). Built-in wins on a name collision; otherwise first found.

export const BUILTIN_ROOT = "$HOME/.skills";
export const PROJECT_ROOT = `${REPO_DIR}/${SKILLS_DIR}`;

const ROOTS: { root: string; builtin: boolean }[] = [
  { root: BUILTIN_ROOT, builtin: true },
  { root: PROJECT_ROOT, builtin: false },
];

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const leaf = (skillMdPath: string) =>
  skillMdPath.replace(/\/SKILL\.md$/, "").split("/").pop() ?? "";

export type ResolvedSkill = { name: string; dir: string; builtin: boolean };

/**
 * Locate a skill folder by leaf name across both roots, at any depth. Built-in
 * root searched first (precedence). Returns the first dir that holds a SKILL.md,
 * or null if none.
 */
export async function resolveSkillDir(
  box: SandboxBox,
  name: string,
): Promise<ResolvedSkill | null> {
  for (const { root, builtin } of ROOTS) {
    const r = await box.run("bash", [
      "-c",
      `find ${root} -type d -name ${shq(name)} 2>/dev/null | ` +
        `while read -r d; do [ -f "$d/SKILL.md" ] && echo "$d" && break; done | head -n1`,
    ]);
    const dir = r.stdout.trim();
    if (dir) return { name, dir, builtin };
  }
  return null;
}

export type EnumeratedSkill = { name: string; description: string; builtin: boolean };

/**
 * Enumerate every skill across both roots (built-in first), at any depth.
 * Deduplicates by leaf name, keeping the first seen (built-in precedence, then
 * first found) — matching the discovery scanner and hermes/pi behavior.
 */
export async function enumerateSkills(box: SandboxBox): Promise<EnumeratedSkill[]> {
  const out: EnumeratedSkill[] = [];
  const seen = new Set<string>();
  for (const { root, builtin } of ROOTS) {
    const r = await box.run("bash", [
      "-c",
      `find ${root} -type f -name SKILL.md 2>/dev/null | sort`,
    ]);
    const paths = r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    for (const p of paths) {
      const name = leaf(p);
      if (!name || seen.has(name)) continue;
      const md = await box.readFile(p).catch(() => null);
      if (!md) continue;
      const description = extractDescription(md);
      if (!description) continue;
      seen.add(name);
      out.push({ name, description, builtin });
    }
  }
  return out;
}
