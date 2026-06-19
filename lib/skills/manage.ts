import "server-only";
import type { SandboxBox } from "@/lib/sandbox/types";
import { REPO_DIR, SKILLS_DIR } from "@/lib/prompt/paths";
import { fuzzyFindAndReplace, formatNoMatchHint } from "@/lib/skills/fuzzy-match";
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

const skillAbs = (name: string) => `${REPO_DIR}/${SKILLS_DIR}/${name}`;

async function exists(box: SandboxBox, abs: string): Promise<boolean> {
  const r = await box.run("bash", ["-c", `test -e '${abs}' && echo yes || echo no`]);
  return r.stdout.trim() === "yes";
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

      const present = await exists(box, skillAbs(name));
      if (action === "create" && present) {
        return err(`Skill '${name}' already exists. Use action 'edit' or 'patch' to change it.`);
      }
      if (action === "edit" && !present) {
        return err(`Skill '${name}' not found. Use action 'create' to make a new skill.`);
      }

      await writeFileAt(box, `${skillAbs(name)}/SKILL.md`, content);
      return ok(`Skill '${name}' ${action === "create" ? "created" : "updated"}.`);
    }

    case "patch": {
      const oldString = args.old_string;
      const newString = args.new_string;
      if (!oldString) return err("'old_string' is required for 'patch'.");
      if (newString === undefined || newString === null) {
        return err("'new_string' is required for 'patch' (use an empty string to delete text).");
      }
      if (!(await exists(box, skillAbs(name)))) return err(`Skill '${name}' not found.`);

      let targetAbs = `${skillAbs(name)}/SKILL.md`;
      const patchingSkillMd = !args.file_path;
      if (args.file_path) {
        const pErr = validateFilePath(args.file_path);
        if (pErr) return err(pErr);
        targetAbs = `${skillAbs(name)}/${args.file_path}`;
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
      if (!(await exists(box, skillAbs(name)))) return err(`Skill '${name}' not found.`);
      await box.run("bash", ["-c", `rm -rf '${skillAbs(name)}'`]);
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
      if (!(await exists(box, skillAbs(name)))) {
        return err(`Skill '${name}' not found. Create the skill before adding files.`);
      }
      await writeFileAt(box, `${skillAbs(name)}/${args.file_path}`, fileContent);
      return ok(`Wrote ${args.file_path} to skill '${name}'.`);
    }

    case "remove_file": {
      const pErr = validateFilePath(args.file_path ?? "");
      if (pErr) return err(pErr);
      if (!(await exists(box, skillAbs(name)))) return err(`Skill '${name}' not found.`);
      const targetAbs = `${skillAbs(name)}/${args.file_path}`;
      if (!(await exists(box, targetAbs))) {
        return err(`File not found: ${args.file_path} in skill '${name}'.`);
      }
      await box.run("bash", ["-c", `rm -f '${targetAbs}'`]);
      return ok(`Removed ${args.file_path} from skill '${name}'.`);
    }

    default:
      return err(`Unknown action '${action}'.`);
  }
}
