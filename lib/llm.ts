import "server-only";
import crypto from "node:crypto";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createXai } from "@ai-sdk/xai";
import { createMistral } from "@ai-sdk/mistral";
import { createDeepSeek } from "@ai-sdk/deepseek";
import {
  wrapLanguageModel,
  type LanguageModel,
  type LanguageModelMiddleware,
} from "ai";
import { getAppSettings, type Settings } from "@/lib/settings";
import { isModelSlug } from "@/lib/models";
import { isCatalogModel } from "@/lib/gateway-models";
import { gatewayByokOptions } from "@/lib/gateway-byok";
import { getEndpointWithKey } from "@/lib/endpoints";
import { getKeyMap } from "@/lib/api-keys";
import { providerOf, type ProviderId } from "@/lib/providers";

/**
 * A ready-to-use language model plus the request-scoped provider options it
 * needs. Pass `model` + `providerOptions` straight to `generateText`,
 * `streamText`, or an agent — they work the same in every connection mode.
 */
export type ResolvedModel = {
  modelId: string;
  model: LanguageModel;
  providerOptions?: Awaited<ReturnType<typeof gatewayByokOptions>>;
};

// Validate a requested model id against the active mode; fall back otherwise.
async function pickModelId(
  settings: Settings,
  requested: string | undefined,
  fallback: string,
): Promise<string> {
  if (!requested) return fallback;
  if (settings.connectionMode === "compatible") return requested; // endpoint id
  const ok =
    settings.connectionMode === "custom"
      ? isModelSlug(requested)
      : await isCatalogModel(requested);
  return ok ? requested : fallback;
}

// Replicate the AI Gateway's automatic Anthropic prompt caching on the direct
// path: stamp ephemeral cache breakpoints on the system prefix (system + tools)
// and on the latest message, so each tool-loop step reuses the cached prefix
// instead of re-reading the whole conversation. Without this, going direct
// re-processes the full prompt every step — the slowdown vs the gateway.
const anthropicCacheMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v3",
  transformParams: async ({ params }) => {
    const prompt = params.prompt;
    const stamp = (m: (typeof prompt)[number]) => {
      m.providerOptions = {
        ...(m.providerOptions ?? {}),
        anthropic: { cacheControl: { type: "ephemeral" } },
      };
    };
    const lastSystem = [...prompt].reverse().find((m) => m.role === "system");
    if (lastSystem) stamp(lastSystem); // caches tools + system (stable prefix)
    if (prompt.length) stamp(prompt[prompt.length - 1]); // rolling history cache
    return params;
  },
};

// Mistral chat-completions caching is NOT automatic — it only caches when the
// request carries a `prompt_cache_key`, and the AI SDK strips unknown provider
// options, so we inject it at the HTTP layer. The key must be stable across a
// conversation; the system prompt is frozen per chat, so its hash is a stable
// per-chat identifier (and chats sharing a prompt share the cache, which is fine).
const mistralCacheFetch: typeof fetch = async (input, init) => {
  if (init && typeof init.body === "string") {
    try {
      const body = JSON.parse(init.body);
      if (Array.isArray(body.messages) && !body.prompt_cache_key) {
        const sys = body.messages.find((m: { role: string }) => m.role === "system");
        const seed = typeof sys?.content === "string" ? sys.content : init.body;
        body.prompt_cache_key = crypto
          .createHash("sha256")
          .update(seed)
          .digest("hex")
          .slice(0, 32);
        init = { ...init, body: JSON.stringify(body) };
      }
    } catch {
      // non-JSON body — leave the request untouched
    }
  }
  return fetch(input, init);
};

// Build a direct provider client for "custom" (provide-your-own-keys) mode.
// `id` is the provider's NATIVE model id (the gateway is not involved), so no
// slug translation happens — it's passed straight to the provider package.
function directModel(
  provider: string,
  id: string,
  apiKey: string,
): LanguageModel {
  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey })(id);
    case "anthropic":
      return wrapLanguageModel({
        model: createAnthropic({ apiKey })(id),
        middleware: anthropicCacheMiddleware,
      });
    case "google":
      return createGoogleGenerativeAI({ apiKey })(id);
    case "xai":
      return createXai({ apiKey })(id);
    case "mistral":
      return createMistral({ apiKey, fetch: mistralCacheFetch })(id);
    case "deepseek":
      return createDeepSeek({ apiKey })(id);
    default:
      throw new Error(
        `Provider "${provider}" is not supported with your own keys — ` +
          `use an OpenAI-compatible endpoint instead.`,
      );
  }
}

// Turn a resolved model id into a usable model object for the active mode:
// - gateway:    deployment's hosted gateway key (plain slug)
// - custom:     your own provider key, called directly (no gateway); ids are
//               stored `provider/<native-id>` — strip the prefix to call.
// - compatible: direct OpenAI-compatible endpoint (no gateway)
async function build(
  settings: Settings,
  modelId: string,
): Promise<ResolvedModel> {
  if (settings.connectionMode === "compatible") {
    const ep = await getEndpointWithKey(modelId);
    if (!ep) throw new Error("No OpenAI-compatible endpoint configured");
    const model = createOpenAICompatible({
      name: ep.name,
      baseURL: ep.baseUrl,
      apiKey: ep.apiKey,
    })(ep.model);
    return { modelId, model };
  }
  if (settings.connectionMode === "custom") {
    const provider = providerOf(modelId);
    const nativeId = modelId.slice(provider.length + 1); // drop "provider/"
    const apiKey = (await getKeyMap())[provider as ProviderId];
    if (!apiKey) {
      throw new Error(`No API key configured for provider "${provider}".`);
    }
    return { modelId, model: directModel(provider, nativeId, apiKey) };
  }
  return { modelId, model: modelId };
}

/**
 * The "AI Agent" model — used for the streaming chat. Honors a per-request
 * override (from the chat's model picker), falling back to the configured
 * agent model when the override isn't valid for the active mode.
 */
export async function resolveAgentModel(
  requested?: string,
): Promise<ResolvedModel> {
  const settings = await getAppSettings();
  const modelId = await pickModelId(settings, requested, settings.defaultModel);
  return build(settings, modelId);
}

/**
 * The "General AI" model — used for lightweight background calls (e.g. chat
 * titles). Uses the configured general model, or the AI Agent model when it's
 * unset ("Same as AI Agent") or no longer valid for the active mode.
 */
export async function resolveGeneralModel(): Promise<ResolvedModel> {
  const settings = await getAppSettings();
  const wanted = settings.generalModel?.trim() || settings.defaultModel;
  const modelId = await pickModelId(settings, wanted, settings.defaultModel);
  try {
    return await build(settings, modelId);
  } catch {
    // e.g. a saved compatible endpoint was removed — fall back to the agent model
    return build(settings, settings.defaultModel);
  }
}
