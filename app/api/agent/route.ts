import {
  ToolLoopAgent,
  tool,
  createAgentUIStream,
  createUIMessageStream,
  createUIMessageStreamResponse,
  createIdGenerator,
  generateText,
  type UIMessage,
  type InferUITools,
} from "ai";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { getChat, createChat, renameChat, saveMessages } from "@/lib/chats";
import type { Project } from "@/lib/db/schema";
import { VercelSandbox } from "@/lib/sandbox/vercel";
import { resolveAgentModel, resolveGeneralModel } from "@/lib/llm";
import { listSecrets, getToken } from "@/lib/user-secrets";
import { getProject, getDefaultProject } from "@/lib/projects";
import { getGithubAuth } from "@/lib/github-account";
import { buildInstructions } from "@/lib/prompt/build";
import { REPO_DIR, SKILLS_DIR } from "@/lib/prompt/paths";
import { scanSkills, type Skill } from "@/lib/prompt/skills";
import { manageSkill } from "@/lib/skills/manage";
import { validateSkillName } from "@/lib/skills/validate";
import { cloneUrlWithToken } from "@/lib/github";

export const maxDuration = 300; // one streamed turn, up to 5 min

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

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const userId = session.user.id;

  const {
    messages,
    id: chatId,
    model: requestedModel,
    projectId: requestedProjectId,
  }: {
    messages: UIMessage[];
    id: string;
    model?: string;
    projectId?: string | null;
  } = await req.json();

  if (!chatId) return new Response("Missing chat id", { status: 400 });

  // Resolve the AI Agent model for the active connection mode (gateway / BYOK /
  // compatible), honoring the per-request model override.
  let resolved;
  try {
    resolved = await resolveAgentModel(requestedModel);
  } catch (e) {
    return new Response((e as Error).message, { status: 400 });
  }
  const { modelId, model: agentModel, providerOptions } = resolved;

  // Ensure the chat exists and is owned by this user (created on first message).
  // New chats start untitled; the title is generated below.
  const existing = await getChat(userId, chatId);
  const needsTitle = !existing?.title;

  // Resolve the project the chat works in. Existing chats keep their stored
  // project (we never trust the request body for them — the sandbox is already
  // cloned for that repo). New chats use the requested project, falling back to
  // the user's default.
  let project: Project | null = null;
  if (existing) {
    project = existing.projectId
      ? await getProject(userId, existing.projectId)
      : null;
  } else {
    project = requestedProjectId
      ? await getProject(userId, requestedProjectId)
      : await getDefaultProject(userId);
  }

  // GitHub auth (PAT + commit identity) when this chat has a project.
  const githubAuth = project ? await getGithubAuth(userId) : null;

  // System prompt: assembled and frozen when the chat is created, then reused
  // every turn (no rebuild, no rescan). On a new chat we scan the project's
  // skills and build the prompt now — skills are read from GitHub, not the
  // sandbox, so this works before any box exists.
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
      title: null,
      model: modelId,
      projectId: project?.id ?? null,
      systemPrompt: instructions,
    });
  }

  // Generate a title for brand-new chats with the General AI model, in parallel
  // with the streamed response, then push it to the client (see execute below).
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
  // init + fetch + reset rather than `git clone <dir>` (which needs an empty
  // target). The PAT is embedded in the origin URL so the agent can pull/push
  // via runBash; the box is per-chat and isolated. (Phase 2: move auth to a
  // credential helper so the PAT isn't persisted in the sandbox's .git/config.)
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
      runBash: tool({
        description: "Run a shell command inside the isolated sandbox.",
        inputSchema: z.object({ cmd: z.string() }),
        execute: async ({ cmd }) => {
          return (await box()).run("bash", ["-c", cmd]);
        },
      }),
      readFile: tool({
        description: "Read a file from the sandbox filesystem.",
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => {
          try {
            return { content: await (await box()).readFile(path) };
          } catch (e) {
            return { error: (e as Error).message };
          }
        },
      }),
      writeFile: tool({
        description: "Write (or overwrite) a file in the sandbox filesystem.",
        inputSchema: z.object({ path: z.string(), content: z.string() }),
        execute: async ({ path, content }) => {
          try {
            await (await box()).writeFile(path, content);
            return { ok: true, path };
          } catch (e) {
            return { error: (e as Error).message };
          }
        },
      }),
      listFiles: tool({
        description: "List the contents of a directory in the sandbox.",
        inputSchema: z.object({ path: z.string().default(".") }),
        execute: async ({ path }) => {
          try {
            return { listing: await (await box()).listDir(path) };
          } catch (e) {
            return { error: (e as Error).message };
          }
        },
      }),
      load_skill: tool({
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
        execute: async ({ name, file }) => {
          const nameErr = validateSkillName(name);
          if (nameErr) return { error: nameErr };
          const dir = `${REPO_DIR}/${SKILLS_DIR}/${name}`;
          try {
            const b = await box();
            if (file) {
              if (file.includes("..") || !/^[A-Za-z0-9._/-]+$/.test(file)) {
                return { error: `Invalid file path "${file}".` };
              }
              return { name, file, content: await b.readFile(`${dir}/${file}`) };
            }
            const instructions = await b.readFile(`${dir}/SKILL.md`);
            const ls = await b.run("bash", [
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
        },
      }),
      manage_skill: tool({
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
        execute: async (a) => manageSkill(await box(), a),
      }),
      list_tokens: tool({
        description:
          "List the names, descriptions, and types of the user's stored " +
          "secrets and connected accounts (NO values). Call this to discover " +
          "what credentials are available before using get_token.",
        inputSchema: z.object({}),
        execute: async () => {
          const items = await listSecrets(userId);
          return {
            tokens: items.map((t) => ({
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
      get_token: tool({
        description:
          "Fetch a usable credential by name. Static secrets return the stored " +
          "value; OAuth connections return a fresh access token. Returns an " +
          "error if the name is unknown or a connection needs re-authentication.",
        inputSchema: z.object({ name: z.string() }),
        execute: async ({ name }) => {
          try {
            return { value: await getToken(userId, name) };
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

  return createUIMessageStreamResponse({ stream });
}
