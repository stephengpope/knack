import "server-only";
import {
  ToolLoopAgent,
  tool,
  createAgentUIStream,
  createUIMessageStream,
  createIdGenerator,
  generateText,
  type UIMessage,
  type InferUITools,
} from "ai";
import { z } from "zod";
import {
  getChat,
  createChat,
  renameChat,
  saveMessages,
  setChatGitState,
} from "@/lib/chats";
import { gitSync } from "@/lib/git/sync";
import type { Project } from "@/lib/db/schema";
import { VercelSandbox } from "@/lib/sandbox/vercel";
import { resolveAgentModel, resolveGeneralModel } from "@/lib/llm";
import { secretsList, secretGet } from "@/lib/user-secrets";
import { getProject, getDefaultProject } from "@/lib/projects";
import { getGithubAuth } from "@/lib/github-account";
import { buildInstructions } from "@/lib/prompt/build";
import { REPO_DIR } from "@/lib/prompt/paths";
import { scanSkills, type Skill } from "@/lib/skills/discover";
import { skillLoad, skillsList } from "@/lib/skills/read";
import { skillManage } from "@/lib/skills/manage";
import { fileRead } from "@/lib/files/read";
import { fileEdit } from "@/lib/files/edit";
import { searchFiles } from "@/lib/files/search";
import { cloneUrlWithToken } from "@/lib/github";

function firstUserText(messages: UIMessage[]): string {
  const m = messages.find((x) => x.role === "user");
  if (!m) return "New chat";
  const text = (m.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ")
    .trim();
  return text || "New chat";
}

export type RunAgentTurnParams = {
  userId: string;
  chatId: string;
  messages: UIMessage[];
  /** Per-request model override, resolved for the active connection mode. */
  model?: string;
  /** Project for a NEW chat; ignored for existing chats (they keep their own). */
  projectId?: string | null;
  /** Chat-creation fields used only when the chat is new (cron sets these). */
  chat?: { title?: string | null; source?: string; sourceRef?: string | null };
};

/**
 * The agent turn — model resolve, chat lookup/create, prompt assembly, sandbox +
 * tools, the ToolLoopAgent run, and the UI message stream (which persists on
 * finish). No HTTP/session coupling: the caller supplies `userId` (from a
 * session in the route, from `project.userId` in cron). Returns the UI stream
 * plus a `sync` closure that commits + pushes the repo after the turn; the
 * caller decides when to run it (e.g. inside `after()`).
 *
 * Throws on model-resolution failure (caller maps to a 400 / logs).
 */
export async function runAgentTurn(params: RunAgentTurnParams) {
  const { userId, chatId, messages } = params;

  // Resolve the AI Agent model for the active connection mode (gateway / BYOK /
  // compatible), honoring the per-request model override.
  const {
    modelId,
    model: agentModel,
    providerOptions,
  } = await resolveAgentModel(params.model);

  // Ensure the chat exists and is owned by this user (created on first message).
  const existing = await getChat(userId, chatId);
  const desiredTitle = params.chat?.title ?? null;
  const needsTitle = existing ? !existing.title : !desiredTitle;

  // Resolve the project the chat works in. Existing chats keep their stored
  // project (the sandbox is already cloned for that repo). New chats use the
  // requested project, falling back to the user's default.
  let project: Project | null = null;
  if (existing) {
    project = existing.projectId
      ? await getProject(userId, existing.projectId)
      : null;
  } else {
    project = params.projectId
      ? await getProject(userId, params.projectId)
      : await getDefaultProject(userId);
  }

  // GitHub auth (PAT + commit identity) when this chat has a project.
  const githubAuth = project ? await getGithubAuth(userId) : null;

  // System prompt: assembled and frozen when the chat is created, then reused
  // every turn. On a new chat we scan the project's skills and build the prompt
  // now — skills are read from GitHub, not the sandbox, so this works before any
  // box exists.
  let instructions: string;
  if (existing?.systemPrompt) {
    instructions = existing.systemPrompt;
  } else {
    let skills: Skill[] = [];
    if (project && githubAuth) {
      try {
        skills = await scanSkills(githubAuth.pat, project);
      } catch {
        skills = []; // a scan failure must not block creating the chat
      }
    }
    instructions = await buildInstructions(
      project,
      githubAuth?.pat ?? null,
      skills,
    );
  }

  // Create the chat row on its first message, with the prompt baked in.
  if (!existing) {
    await createChat(userId, {
      id: chatId,
      title: desiredTitle,
      model: modelId,
      projectId: project?.id ?? null,
      systemPrompt: instructions,
      source: params.chat?.source ?? "user",
      sourceRef: params.chat?.sourceRef ?? null,
    });
  }

  // Generate a title for brand-new untitled chats with the General AI model, in
  // parallel with the streamed response, then push it to the client.
  const titlePromise = needsTitle
    ? resolveGeneralModel()
        .then(({ model, providerOptions: po }) =>
          generateText({
            model,
            providerOptions: po,
            maxOutputTokens: 250,
            system:
              "Generate a short (3-6 word) title for this chat based on the " +
              "user's first message. Return ONLY the title, nothing else.",
            prompt: firstUserText(messages),
          }),
        )
        .then((r) => r.text.replace(/^["'#*\s]+|["'\s]+$/g, "").slice(0, 80))
    : null;

  const sandbox = new VercelSandbox();

  // Get the chat's box, checking out the project repo on first use. The repo is
  // checked out at the sandbox root (REPO_DIR), which may already exist, so we
  // init + fetch + reset rather than `git clone <dir>`. The PAT is embedded in
  // the origin URL so the agent can pull/push via bash_run; the box is per-chat
  // and isolated.
  let repoChecked = false;
  async function box() {
    const b = await sandbox.getOrCreate(chatId);
    if (project && githubAuth && !repoChecked) {
      const check = await b.run("bash", [
        "-c",
        `test -d ${REPO_DIR}/.git && echo ok || echo no`,
      ]);
      if (check.stdout.trim() !== "ok") {
        const url = cloneUrlWithToken(
          githubAuth.pat,
          project.repoOwner,
          project.repoName,
        );
        const branch = JSON.stringify(project.defaultBranch);
        const email = githubAuth.githubUserId
          ? `${githubAuth.githubUserId}+${githubAuth.login}@users.noreply.github.com`
          : `${githubAuth.login}@users.noreply.github.com`;
        await b.run("bash", [
          "-c",
          `cd ${REPO_DIR} && ` +
            `git init -q -b ${branch} && ` +
            `git remote add origin ${url} && ` +
            `git fetch -q --depth=1 origin ${branch} && ` +
            `git reset -q --hard origin/${project.defaultBranch} && ` +
            `git branch -q --set-upstream-to=origin/${project.defaultBranch} ${branch} && ` +
            `git config user.name ${JSON.stringify(githubAuth.login)} && ` +
            `git config user.email ${JSON.stringify(email)}`,
        ]);
      }
      repoChecked = true;
    }
    return b;
  }

  const tools = {
    bash_run: tool({
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
      execute: async ({ cmd }) => {
        return (await box()).run("bash", ["-c", cmd]);
      },
    }),
    file_read: tool({
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
    }),
    file_write: tool({
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
    }),
    file_edit: tool({
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
    }),
    files_list: tool({
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
    }),
    search_files: tool({
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
    }),
    skill_load: tool({
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
    }),
    skills_list: tool({
      description:
        "List the project's skills (name + description), read live from the " +
        "repo. Use this to see the current set — including skills created or " +
        "edited this chat — which may not yet appear in the <available_skills> " +
        "list in your prompt (that list is fixed when the chat starts).",
      inputSchema: z.object({}),
      execute: async () => skillsList(await box()),
    }),
    skill_manage: tool({
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
    }),
    secrets_list: tool({
      description:
        "List the names, descriptions, and types of the user's stored " +
        "secrets and connected accounts (NO values). Call this to discover " +
        "what credentials are available before using secret_get.",
      inputSchema: z.object({}),
      execute: async () => {
        const items = await secretsList(userId);
        return {
          secrets: items.map((t) => ({
            name: t.name,
            description: t.description,
            kind: t.kind,
            provider: t.provider,
            scopes: t.scopes,
            status: t.status,
          })),
        };
      },
    }),
    secret_get: tool({
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
    }),
  };

  const agent = new ToolLoopAgent({
    model: agentModel,
    providerOptions, // request-scoped BYOK when present (gateway custom mode)
    instructions, // base prompt, plus project repo context when the chat has one
    tools,
  });

  // Message type includes the custom "chat-title" data part used below.
  type ChatMessage = UIMessage<
    unknown,
    { "chat-title": string },
    InferUITools<typeof tools>
  >;

  const stream = createUIMessageStream<ChatMessage>({
    originalMessages: messages as ChatMessage[],
    // stable, server-generated ids for assistant messages (required for persistence)
    generateId: createIdGenerator({ prefix: "msg", size: 16 }),
    onFinish: async ({ messages: final }) => {
      await saveMessages(chatId, final as unknown as UIMessage[]);
    },
    execute: async ({ writer }) => {
      // Stream the agent's response. The agent stream never emits data parts,
      // so it's safe to widen it to the writer's (data-part-carrying) type.
      writer.merge(
        (await createAgentUIStream({
          agent,
          uiMessages: messages as ChatMessage[],
        })) as unknown as Parameters<typeof writer.merge>[0],
      );
      // Once the parallel title resolves, persist it and push it to the client
      // as a transient data part (not stored in the saved message history).
      if (titlePromise) {
        try {
          const title = await titlePromise;
          if (title) {
            writer.write({
              type: "data-chat-title",
              data: title,
              transient: true,
            });
            await renameChat(userId, chatId, title);
          }
        } catch {
          // title generation is best-effort; leave the chat as "Untitled"
        }
      }
    },
  });

  // Commit + push the chat's repo after the turn's file edits. Returned as a
  // closure (not run here) so the caller schedules it — `after()` in the route,
  // or post-drain in the cron worker. Best-effort; failures just leave the chat
  // dirty for the next turn's sync to re-attempt.
  const sync =
    project && githubAuth
      ? async () => {
          try {
            const result = await gitSync(await box(), project.defaultBranch);
            await setChatGitState(userId, chatId, result);
          } catch {
            // swallow — the dot reflects DB state, which simply won't advance
          }
        }
      : null;

  return { stream, sync };
}

/** Drain a UI message stream server-side (no client) so its `onFinish` —
 *  message persistence — runs. Used by the cron worker. */
export async function drainStream(
  stream: ReadableStream<unknown>,
): Promise<void> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}
