import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { getAppSettings, type Settings } from "@/lib/settings";
import { isModelSlug } from "@/lib/models";
import { isCatalogModel } from "@/lib/gateway-models";
import { gatewayByokOptions } from "@/lib/gateway-byok";
import { getEndpointWithKey } from "@/lib/endpoints";

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

// Turn a resolved model id into a usable model object for the active mode:
// - gateway:    deployment's hosted gateway key (plain slug)
// - custom:     shared provider keys via gateway BYOK
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
    return { modelId, model: modelId, providerOptions: await gatewayByokOptions() };
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
