import "server-only";
import type { SandboxBox } from "@/lib/sandbox/types";
import { PROJECT_ROOT, resolveSkillDir } from "@/lib/skills/resolve";
import { fuzzyFindAndReplace, formatNoMatchHint } from "@/lib/files/fuzzy-match";
import {
  MAX_FILE_BYTES,
  validateContentSize,
  validateFilePath,
  validateFrontmatter,
  validateSkillName,
} from "@/lib/skills/validate";

export type ManageAction =
  | "create"
  | "edit"
  | "patch"
  | "delete"
  | "write_file"
  | "remove_file";

export type ManageArgs = {
  action: ManageAction;
  name: string;
  content?: string;
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
  file_path?: string;
  file_content?: string;
};

export type ManageResult =
  | { success: true; message: string }
  | { success: false; error: string; preview?: string };

const err = (error: string, preview?: string): ManageResult => ({ success: false, error, preview });
const ok = (message: string): ManageResult => ({ success: true, message });

// New skills are created flat under the project root; existing ones are located
// by the resolver (any depth, project or built-in).
const newSkillAbs = (name: string) => `${PROJECT_ROOT}/${name}`;

/** Resolve an existing PROJECT skill's dir for mutation. Built-in skills are
 *  vendored/read-only; refuse to edit them. Returns the dir or an error result. */
async function resolveForWrite(
  box: SandboxBox,
  name: string,
): Promise<{ dir: string } | ManageResult> {
  const found = await resolveSkillDir(box, name);
  if (!found) return err(`Skill '${name}' not found.`);
  if (found.builtin) {
    return err(`'${name}' is a built-in skill and can't be edited.`);
  }
  return { dir: found.dir };
}

async function readMaybe(box: SandboxBox, abs: string): Promise<string | null> {
  try {
    return await box.readFile(abs);
  } catch {
    return null;
  }
}

async function writeFileAt(box: SandboxBox, abs: string, content: string): Promise<void> {
  const dir = abs.slice(0, abs.lastIndexOf("/"));
  await box.run("bash", ["-c", `mkdir -p '${dir}'`]);
  await box.writeFile(abs, content);
}

export async function skillManage(box: SandboxBox, args: ManageArgs): Promise<ManageResult> {
  const { action, name } = args;

  const nameErr = validateSkillName(name);
  if (nameErr) return err(nameErr);

  switch (action) {
    case "create":
    case "edit": {
      const content = args.content;
      if (!content) return err(`'content' (full SKILL.md) is required for '${action}'.`);
      const fm = validateFrontmatter(content);
      if (fm.error) return err(fm.error);
      if (fm.name !== name) {
        return err(`Frontmatter name '${fm.name}' must match the skill name '${name}'.`);
      }
      const sizeErr = validateContentSize(content);
      if (sizeErr) return err(sizeErr);

      if (action === "create") {
        const dup = await resolveSkillDir(box, name);
        if (dup) {
          return err(
            dup.builtin
              ? `'${name}' is a built-in skill — choose a different name.`
              : `Skill '${name}' already exists. Use action 'edit' or 'patch' to change it.`,
          );
        }
        await writeFileAt(box, `${newSkillAbs(name)}/SKILL.md`, content);
        return ok(`Skill '${name}' created.`);
      }

      const target = await resolveForWrite(box, name);
      if ("success" in target) return target;
      await writeFileAt(box, `${target.dir}/SKILL.md`, content);
      return ok(`Skill '${name}' updated.`);
    }

    case "patch": {
      const oldString = args.old_string;
      const newString = args.new_string;
      if (!oldString) return err("'old_string' is required for 'patch'.");
      if (newString === undefined || newString === null) {
        return err("'new_string' is required for 'patch' (use an empty string to delete text).");
      }
      const patchTarget = await resolveForWrite(box, name);
      if ("success" in patchTarget) return patchTarget;

      let targetAbs = `${patchTarget.dir}/SKILL.md`;
      const patchingSkillMd = !args.file_path;
      if (args.file_path) {
        const pErr = validateFilePath(args.file_path);
        if (pErr) return err(pErr);
        targetAbs = `${patchTarget.dir}/${args.file_path}`;
      }

      const current = await readMaybe(box, targetAbs);
      if (current === null) {
        return err(`File not found: ${args.file_path ?? "SKILL.md"} in skill '${name}'.`);
      }

      const result = fuzzyFindAndReplace(current, oldString, newString, args.replace_all ?? false);
      if (result.error) {
        const hint = formatNoMatchHint(result.error, result.count, oldString, current);
        return err(result.error + hint, current.slice(0, 500));
      }

      if (patchingSkillMd) {
        const fm = validateFrontmatter(result.content);
        if (fm.error) return err(`Patch would break SKILL.md: ${fm.error}`);
      }
      const sizeErr = validateContentSize(result.content, args.file_path ?? "SKILL.md");
      if (sizeErr) return err(sizeErr);

      await writeFileAt(box, targetAbs, result.content);
      return ok(
        `Patched ${args.file_path ?? "SKILL.md"} in '${name}' ` +
          `(${result.count} replacement${result.count === 1 ? "" : "s"}, ${result.strategy}).`,
      );
    }

    case "delete": {
      const delTarget = await resolveForWrite(box, name);
      if ("success" in delTarget) return delTarget;
      await box.run("bash", ["-c", `rm -rf '${delTarget.dir}'`]);
      return ok(`Skill '${name}' deleted.`);
    }

    case "write_file": {
      const pErr = validateFilePath(args.file_path ?? "");
      if (pErr) return err(pErr);
      const fileContent = args.file_content;
      if (fileContent === undefined || fileContent === null) {
        return err("'file_content' is required for 'write_file'.");
      }
      if (Buffer.byteLength(fileContent, "utf8") > MAX_FILE_BYTES) {
        return err(`file exceeds ${MAX_FILE_BYTES} bytes.`);
      }
      const wfTarget = await resolveForWrite(box, name);
      if ("success" in wfTarget) return wfTarget;
      await writeFileAt(box, `${wfTarget.dir}/${args.file_path}`, fileContent);
      return ok(`Wrote ${args.file_path} to skill '${name}'.`);
    }

    case "remove_file": {
      const pErr = validateFilePath(args.file_path ?? "");
      if (pErr) return err(pErr);
      const rfTarget = await resolveForWrite(box, name);
      if ("success" in rfTarget) return rfTarget;
      const targetAbs = `${rfTarget.dir}/${args.file_path}`;
      const present = await box.run("bash", [
        "-c",
        `test -e '${targetAbs}' && echo yes || echo no`,
      ]);
      if (present.stdout.trim() !== "yes") {
        return err(`File not found: ${args.file_path} in skill '${name}'.`);
      }
      await box.run("bash", ["-c", `rm -f '${targetAbs}'`]);
      return ok(`Removed ${args.file_path} from skill '${name}'.`);
    }

    default:
      return err(`Unknown action '${action}'.`);
  }
}
