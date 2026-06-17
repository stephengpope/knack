import {
  ToolLoopAgent,
  tool,
  createAgentUIStreamResponse,
  createIdGenerator,
  type UIMessage,
  type InferAgentUIMessage,
  type LanguageModel,
} from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { getChat, createChat, renameChat, saveMessages } from "@/lib/chats";
import { VercelSandbox } from "@/lib/sandbox/vercel";
import { isModelSlug } from "@/lib/models";
import { isCatalogModel } from "@/lib/gateway-models";
import { gatewayByokOptions } from "@/lib/gateway-byok";
import { getAppSettings } from "@/lib/settings";
import { getEndpointWithKey } from "@/lib/endpoints";
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

  const settings = await getAppSettings();

  // Resolve the model id string (also persisted on the chat). In compatible
  // mode this is an endpoint id; otherwise a gateway "provider/model" slug.
  let modelId = settings.defaultModel;
  if (requestedModel) {
    if (settings.connectionMode === "compatible") {
      modelId = requestedModel;
    } else if (
      settings.connectionMode === "custom"
        ? isModelSlug(requestedModel)
        : await isCatalogModel(requestedModel)
    ) {
      modelId = requestedModel;
    }
  }

  // Build the language model + provider options for the active mode:
  // - gateway:    deployment's hosted gateway key
  // - custom:     shared provider keys via gateway BYOK
  // - compatible: direct OpenAI-compatible endpoint (no gateway)
  let agentModel: LanguageModel = modelId;
  let providerOptions: Awaited<ReturnType<typeof gatewayByokOptions>>;
  if (settings.connectionMode === "compatible") {
    const ep = await getEndpointWithKey(modelId);
    if (!ep) {
      return new Response("No OpenAI-compatible endpoint configured", {
        status: 400,
      });
    }
    agentModel = createOpenAICompatible({
      name: ep.name,
      baseURL: ep.baseUrl,
      apiKey: ep.apiKey,
    })(ep.model);
  } else if (settings.connectionMode === "custom") {
    providerOptions = await gatewayByokOptions();
  }

  // Ensure the chat exists and is owned by this user (created on first message).
  let chat = await getChat(userId, chatId);
  if (!chat) {
    const title = firstUserText(messages).slice(0, 60);
    chat = await createChat(userId, { id: chatId, title, model: modelId });
  }

  const sandbox = new VercelSandbox();

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
    tools: {
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
    },
  });

  type ChatMessage = InferAgentUIMessage<typeof agent>;

  return createAgentUIStreamResponse({
    agent,
    uiMessages: messages as ChatMessage[],
    originalMessages: messages as ChatMessage[],
    // stable, server-generated ids for assistant messages (required for persistence)
    generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
    onFinish: async ({ messages: final }) => {
      await saveMessages(chatId, final as unknown as UIMessage[]);
      // backfill a title if it was still empty
      if (!chat?.title) {
        await renameChat(userId, chatId, firstUserText(messages).slice(0, 60));
      }
    },
  });
}
