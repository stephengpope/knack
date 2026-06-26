import "server-only";
import { tool } from "ai";
import { z } from "zod";
import type { SandboxBox } from "@/lib/sandbox/types";
import { fileRead } from "@/lib/files/read";
import { fileEdit } from "@/lib/files/edit";
import { searchFiles } from "@/lib/files/search";
import { skillLoad, skillsList } from "@/lib/skills/read";
import { skillManage } from "@/lib/skills/manage";
import { secretsList, secretGet } from "@/lib/user-secrets";
import { globalSecretsList } from "@/lib/global-secrets";
import { sendUserMessage } from "@/lib/messaging/send";

/**
 * Single source of truth for the agent's tools. Each tool is its own builder
 * function so any turn — the main chat (run-turn), the skill-review pass, the
 * supervisor's read-only verify turn — can import and compose whatever subset it
 * needs, on the fly, without redefining a tool. Sandbox tools take the chat's
 * lazy `box` accessor; user-scoped tools take `userId`.
 */
export type BoxAccessor = () => Promise<SandboxBox>;

export function bashRunTool(box: BoxAccessor) {
  return tool({
    description:
      "Run a shell command inside the isolated per-chat sandbox. The repo is " +
      "checked out at the working directory. Use for builds, tests, git, and " +
      "package managers. For routine file work prefer the dedicated tools — " +
      "file_read instead of cat/head/tail, file_edit instead of sed/awk, " +
      "file_write instead of echo/heredoc, search_files instead of grep/find — " +
      "they return structured results and are easier to get right.",
    inputSchema: z.object({
      cmd: z.string().describe("Shell command, run via `bash -c`."),
    }),
    execute: async ({ cmd }) => (await box()).run("bash", ["-c", cmd]),
  });
}

export function fileReadTool(box: BoxAccessor) {
  return tool({
    description:
      "Read a text file with line numbers and pagination. Use this instead of " +
      "cat/head/tail. Output format is 'LINE|CONTENT' per line. Use offset and " +
      "limit to read sections of large files; a selected range over ~100K " +
      "characters is rejected (narrow it). Suggests similar filenames if the " +
      "path is not found. Cannot read images or binary files.",
    inputSchema: z.object({
      path: z.string().describe("Path to the file (absolute, or relative to the repo root)."),
      offset: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe("1-indexed line to start from (default 1)."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(2000)
        .default(500)
        .describe("Max lines to return (default 500, max 2000)."),
    }),
    execute: async ({ path, offset, limit }) => fileRead(await box(), path, offset, limit),
  });
}

export function fileWriteTool(box: BoxAccessor) {
  return tool({
    description:
      "Write content to a file, completely replacing any existing content. Use " +
      "this instead of echo/cat heredoc. Creates parent directories " +
      "automatically. OVERWRITES the entire file — for targeted changes to an " +
      "existing file use file_edit instead, which is safer and far cheaper than " +
      "rewriting. Read the file first if you're not creating it fresh.",
    inputSchema: z.object({
      path: z.string().describe("Path to write (created if absent, overwritten if present)."),
      content: z.string().describe("Complete file content."),
    }),
    execute: async ({ path, content }) => {
      try {
        await (await box()).writeFile(path, content);
        return { ok: true, path };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  });
}

export function fileEditTool(box: BoxAccessor) {
  return tool({
    description:
      "Make a targeted find-and-replace edit in an existing file — the " +
      "preferred way to change a file (use file_write only to create or fully " +
      "replace one). Finds old_string and replaces it with new_string. Matching " +
      "tries an exact match first, then tolerates minor whitespace, " +
      "indentation, escape, and smart-quote drift. old_string must be UNIQUE in " +
      "the file unless replace_all is set — include enough surrounding context " +
      "to single out the spot. Pass an empty new_string to delete the matched " +
      "text. Returns a unified diff and re-reads the file to confirm the edit " +
      "landed; if no match is found you get a 'did you mean?' hint.",
    inputSchema: z.object({
      path: z.string().describe("Path to the existing file to edit."),
      old_string: z
        .string()
        .describe("Exact text to find. Must be unique unless replace_all is true; include surrounding lines for uniqueness."),
      new_string: z
        .string()
        .describe("Replacement text. Empty string deletes the matched text."),
      replace_all: z
        .boolean()
        .default(false)
        .describe("Replace every occurrence instead of requiring a unique match (default false)."),
    }),
    execute: async ({ path, old_string, new_string, replace_all }) =>
      fileEdit(await box(), path, old_string, new_string, replace_all),
  });
}

export function filesListTool(box: BoxAccessor) {
  return tool({
    description:
      "List the immediate contents of a directory. For finding files by name " +
      "across the tree, or searching inside file contents, use search_files " +
      "instead.",
    inputSchema: z.object({
      path: z.string().default(".").describe("Directory to list (default repo root)."),
    }),
    execute: async ({ path }) => {
      try {
        return { listing: await (await box()).listDir(path) };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  });
}

export function searchFilesTool(box: BoxAccessor) {
  return tool({
    description:
      "Search the codebase. Use this instead of grep/rg/find/ls. Two modes via " +
      "`target`: 'content' (default) runs a regex search inside files; 'files' " +
      "finds files by name using a glob pattern (e.g. '*.ts', '*config*'). " +
      "ripgrep-backed (falls back to grep/find), faster than shelling out. For " +
      "content search, output_mode picks the shape: 'content' shows matching " +
      "lines with line numbers, 'files_only' lists just the file paths, 'count' " +
      "gives per-file match counts. Use file_glob to restrict which files are " +
      "searched, and context for surrounding lines.",
    inputSchema: z.object({
      pattern: z
        .string()
        .describe("Regex pattern for content search, or a glob (e.g. '*.ts') when target='files'."),
      target: z
        .enum(["content", "files"])
        .default("content")
        .describe("'content' searches inside files; 'files' finds files by name."),
      path: z.string().default(".").describe("Directory or file to search in (default repo root)."),
      file_glob: z
        .string()
        .optional()
        .describe("Restrict content search to files matching this glob (e.g. '*.ts')."),
      output_mode: z
        .enum(["content", "files_only", "count"])
        .default("content")
        .describe("Content-search output: matching lines, file paths only, or per-file counts."),
      context: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Lines of context before/after each match (content mode)."),
      limit: z.number().int().min(1).default(50).describe("Max results to return (default 50)."),
      offset: z.number().int().min(0).default(0).describe("Skip the first N results (pagination)."),
    }),
    execute: async (a) => searchFiles(await box(), a),
  });
}

export function skillLoadTool(box: BoxAccessor) {
  return tool({
    description:
      "Load a skill's full instructions by name. The result also lists the " +
      "skill's bundled files (references/scripts/templates); call again with " +
      "`file` to load one. The available skills are listed in " +
      "<available_skills> in your system prompt; call this when a task " +
      "matches a skill's description, then follow the instructions it returns.",
    inputSchema: z.object({
      name: z.string(),
      file: z
        .string()
        .optional()
        .describe(
          "Optional bundled file within the skill (e.g. 'scripts/run.sh') " +
            "to load instead of SKILL.md.",
        ),
    }),
    execute: async ({ name, file }) => skillLoad(await box(), name, file),
  });
}

export function skillsListTool(box: BoxAccessor) {
  return tool({
    description:
      "List the project's skills (name + description), read live from the " +
      "repo. Use this to see the current set — including skills created or " +
      "edited this chat — which may not yet appear in the <available_skills> " +
      "list in your prompt (that list is fixed when the chat starts).",
    inputSchema: z.object({}),
    execute: async () => skillsList(await box()),
  });
}

export function skillManageTool(box: BoxAccessor) {
  return tool({
    description:
      "Create, edit, or delete a skill — your reusable, saved procedures for " +
      "recurring task types. Skills live in the project repo under " +
      ".skills/<name>/; this tool validates them before writing the files.\n\n" +
      "Actions: create (new skill — full SKILL.md), patch (targeted " +
      "find-and-replace — PREFERRED for fixes), edit (full SKILL.md rewrite " +
      "— major overhauls only), delete, write_file (add a supporting file " +
      "under references/, templates/, scripts/, or assets/), remove_file.\n\n" +
      "A SKILL.md needs YAML frontmatter with `name` (matching the skill's " +
      "folder) and a specific `description` (what it does AND when to use it), " +
      "then a markdown body: trigger conditions, numbered steps with exact " +
      "commands, pitfalls, and verification steps.\n\n" +
      "Create when: a complex task succeeded, you overcame a tricky error, or " +
      "you discovered a reusable workflow worth keeping. Patch a skill the " +
      "moment you find it outdated or wrong — don't wait to be asked.\n\n" +
      "Always make skill changes through this tool, never by editing files " +
      "under .skills/ directly — it validates the frontmatter and structure.\n\n" +
      "Note: a newly created or edited skill appears in your available-skills " +
      "list starting with the NEXT chat, not the current one.",
    inputSchema: z.object({
      action: z
        .enum(["create", "edit", "patch", "delete", "write_file", "remove_file"])
        .describe("The action to perform."),
      name: z
        .string()
        .describe("Skill name (lowercase, hyphens; matches the skill's folder)."),
      content: z
        .string()
        .optional()
        .describe("Full SKILL.md content (frontmatter + body). Required for create/edit."),
      old_string: z
        .string()
        .optional()
        .describe("For patch: text to find. Include enough context to be unique."),
      new_string: z
        .string()
        .optional()
        .describe("For patch: replacement text (empty string to delete the match)."),
      replace_all: z
        .boolean()
        .optional()
        .describe("For patch: replace all occurrences instead of requiring a unique match."),
      file_path: z
        .string()
        .optional()
        .describe(
          "Supporting-file path under references/templates/scripts/assets/. " +
            "Required for write_file/remove_file; optional for patch (defaults to SKILL.md).",
        ),
      file_content: z
        .string()
        .optional()
        .describe("Content for the file. Required for write_file."),
    }),
    execute: async (a) => skillManage(await box(), a),
  });
}

export function secretsListTool(userId: string) {
  return tool({
    description:
      "List the names, descriptions, and types of the user's stored " +
      "secrets and connected accounts (NO values). Call this to discover " +
      "what credentials are available before using secret_get.",
    inputSchema: z.object({}),
    execute: async () => {
      const [items, globals] = await Promise.all([
        secretsList(userId),
        globalSecretsList(),
      ]);
      const userNames = new Set(items.map((t) => t.name));
      const secrets: Array<{
        name: string;
        description: string | null;
        kind: string;
        provider: string | null;
        scopes: string[] | null;
        status: string | null;
        source: "user" | "global";
      }> = items.map((t) => ({
        name: t.name,
        description: t.description,
        kind: t.kind,
        provider: t.provider,
        scopes: t.scopes,
        status: t.status,
        source: "user",
      }));
      // Admin-set global tokens the user hasn't overridden; resolvable via
      // secret_get (cascade). User secrets of the same name take precedence.
      for (const g of globals) {
        if (userNames.has(g.name)) continue;
        secrets.push({
          name: g.name,
          description: g.description,
          kind: "static",
          provider: null,
          scopes: null,
          status: null,
          source: "global",
        });
      }
      return { secrets };
    },
  });
}

export function secretGetTool(userId: string) {
  return tool({
    description:
      "Fetch a usable credential by name. Static secrets return the stored " +
      "value; OAuth connections return a fresh access token. Returns an " +
      "error if the name is unknown or a connection needs re-authentication. " +
      "Never print a fetched secret value back to the user.",
    inputSchema: z.object({ name: z.string() }),
    execute: async ({ name }) => {
      try {
        return { value: await secretGet(userId, name) };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
  });
}

export function sendMessageTool(userId: string) {
  return tool({
    description:
      "Send a message to the user on their connected messaging app (e.g. " +
      "Telegram). Use to proactively notify them — a finished job, an answer " +
      "they're waiting on, an alert. Returns an error if no app is connected.",
    inputSchema: z.object({
      text: z.string().describe("The message to send."),
      platform: z
        .string()
        .optional()
        .describe("Target platform; defaults to the user's connected app."),
    }),
    execute: async ({ text, platform }) => {
      const result = await sendUserMessage(
        userId,
        text,
        platform as "telegram" | undefined,
      );
      return result.ok ? { ok: true } : { error: result.error };
    },
  });
}

/**
 * The full tool set for an interactive agent turn. Returned as an object literal
 * so the AI SDK keeps each tool's precise type (needed for InferUITools). Other
 * turns compose narrower subsets straight from the individual builders above.
 */
export function buildAgentTools(ctx: { box: BoxAccessor; userId: string }) {
  return {
    bash_run: bashRunTool(ctx.box),
    file_read: fileReadTool(ctx.box),
    file_write: fileWriteTool(ctx.box),
    file_edit: fileEditTool(ctx.box),
    files_list: filesListTool(ctx.box),
    search_files: searchFilesTool(ctx.box),
    skill_load: skillLoadTool(ctx.box),
    skills_list: skillsListTool(ctx.box),
    skill_manage: skillManageTool(ctx.box),
    secrets_list: secretsListTool(ctx.userId),
    secret_get: secretGetTool(ctx.userId),
    send_message: sendMessageTool(ctx.userId),
  };
}
