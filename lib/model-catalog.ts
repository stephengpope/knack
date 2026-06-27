import "server-only";
import { type ModelOption } from "@/lib/models";
import { isReasoningFamily } from "@/lib/reasoning";
import snapshot from "@/lib/model-catalog-snapshot.json";

/**
 * Credential-independent model catalog from models.dev — the public registry
 * hermes and pi both use. The list is fetched WITHOUT any provider key, so it
 * works the same whether a user authenticates with an API key or an OAuth
 * token. The credential is only used to actually call a model (lib/llm.ts).
 *
 * Resolution: live fetch (Next-cached 24h) → bundled snapshot fallback when
 * models.dev is unreachable. Only the providers knack can call directly are
 * kept; ids are the registry's bare ids, prefixed to knack's `provider/id`.
 */

const URL = "https://models.dev/api.json";
export const MODELS_DEV_TAG = "models-dev";

// Providers knack supports in "custom" (direct-SDK) mode. Keys match both
// knack's ProviderId and models.dev's top-level keys.
const SUPPORTED = ["anthropic", "openai", "google", "xai", "mistral", "deepseek"];

type RawModel = { name?: string; reasoning?: boolean };
type RawRegistry = Record<string, { models?: Record<string, RawModel> }>;

async function load(): Promise<RawRegistry> {
  try {
    const res = await fetch(URL, {
      next: { revalidate: 86400, tags: [MODELS_DEV_TAG] },
    });
    if (res.ok) return (await res.json()) as RawRegistry;
  } catch {
    // network/parse failure — fall through to the bundled snapshot
  }
  return snapshot as RawRegistry;
}

function splitId(modelId: string): { provider: string; id: string } {
  const i = modelId.indexOf("/");
  return i === -1
    ? { provider: "", id: modelId }
    : { provider: modelId.slice(0, i), id: modelId.slice(i + 1) };
}

/** Catalog models for the given providers, as `provider/id` ModelOptions. */
export async function getCatalogModels(
  providers: string[],
): Promise<ModelOption[]> {
  const data = await load();
  const out: ModelOption[] = [];
  for (const p of providers) {
    if (!SUPPORTED.includes(p)) continue;
    const models = data[p]?.models;
    if (!models) continue;
    for (const [id, m] of Object.entries(models)) {
      out.push({
        id: `${p}/${id}`,
        label: m.name ?? id,
        reasoning: Boolean(m.reasoning),
      });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Whether a model supports reasoning, per the registry. Falls back to the
 * family allowlist for ids not in the registry (e.g. gateway dot-slugs, or
 * offline). Single source for both the agent-turn gate and the admin UI.
 */
export async function modelSupportsReasoning(modelId: string): Promise<boolean> {
  const { provider, id } = splitId(modelId);
  const data = await load();
  const hit = data[provider]?.models?.[id];
  if (hit) return Boolean(hit.reasoning);
  return isReasoningFamily(provider, id); // gateway slug / offline fallback
}
