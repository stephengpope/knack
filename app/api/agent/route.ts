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
import { VercelSandbox } from "@/lib/sandbox/vercel";
import { resolveAgentModel, resolveGeneralModel } from "@/lib/llm";
import { listSecrets, getToken } from "@/lib/user-secrets";

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
  }: { messages: UIMessage[]; id: string; model?: string } = await req.json();

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
  if (!existing) {
    await createChat(userId, { id: chatId, title: null, model: modelId });
  }

  // Generate a title for brand-new chats with the General AI model, in parallel
  // with the streamed response, then push it to the client (see execute below).
  const titlePromise = needsTitle
    ? resolveGeneralModel()
        .then(({ model, providerOptions: po }) =>
          generateText({
            model,
            providerOptions: po,
            system:
              "Generate a concise 3-6 word title for a conversation that opens " +
              "with the user's message. Plain text only: no quotes, no " +
              "markdown, no trailing punctuation.",
            prompt: firstUserText(messages),
          }),
        )
        .then((r) => r.text.replace(/^["'#*\s]+|["'\s]+$/g, "").slice(0, 80))
    : null;

  const sandbox = new VercelSandbox();

  const tools = {
      runBash: tool({
        description: "Run a shell command inside the isolated sandbox.",
        inputSchema: z.object({ cmd: z.string() }),
        execute: async ({ cmd }) => {
          const box = await sandbox.getOrCreate(chatId);
          return box.run("bash", ["-c", cmd]);
        },
      }),
      readFile: tool({
        description: "Read a file from the sandbox filesystem.",
        inputSchema: z.object({ path: z.string() }),
        execute: async ({ path }) => {
          const box = await sandbox.getOrCreate(chatId);
          try {
            return { content: await box.readFile(path) };
          } catch (e) {
            return { error: (e as Error).message };
          }
        },
      }),
      writeFile: tool({
        description: "Write (or overwrite) a file in the sandbox filesystem.",
        inputSchema: z.object({ path: z.string(), content: z.string() }),
        execute: async ({ path, content }) => {
          const box = await sandbox.getOrCreate(chatId);
          try {
            await box.writeFile(path, content);
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
          const box = await sandbox.getOrCreate(chatId);
          try {
            return { listing: await box.listDir(path) };
          } catch (e) {
            return { error: (e as Error).message };
          }
        },
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
    instructions:
      "You are Knack, a capable AI agent. You have an isolated Linux sandbox " +
      "(node24) for running code and shell commands. Use runBash for commands, " +
      "and the file tools to read, write, and list files inside the sandbox. " +
      "Prefer doing real work in the sandbox over describing it. The user can " +
      "store API secrets and connect OAuth accounts; use list_tokens to see " +
      "what's available and get_token to fetch a value when a task needs one. " +
      "Never print a fetched token value back to the user. Be concise and " +
      "format answers in Markdown.",
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
