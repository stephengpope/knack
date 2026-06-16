import "server-only";
import { DEFAULT_MODEL, type ModelOption } from "@/lib/models";

const GATEWAY_MODELS_URL = "https://ai-gateway.vercel.sh/v1/models";

export const MODELS_CACHE_TAG = "gateway-models";

type GatewayModel = {
  id: string;
  name?: string;
  owned_by?: string;
  type?: string;
  tags?: string[];
};

// Minimal fallback if the catalog can't be fetched (network/listing down).
const FALLBACK: ModelOption[] = [
  { id: DEFAULT_MODEL, label: "Claude Opus 4.8" },
  { id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
];

/**
 * Live catalog of tool-capable chat models from the AI Gateway. Listing models
 * is free (no inference cost). Cached for 24h; bust on demand by revalidating
 * MODELS_CACHE_TAG. The agent is a tool-loop, so we only surface models that
 * support tool use.
 */
export async function fetchGatewayModels(): Promise<ModelOption[]> {
  try {
    const res = await fetch(GATEWAY_MODELS_URL, {
      next: { revalidate: 86400, tags: [MODELS_CACHE_TAG] },
    });
    if (!res.ok) return FALLBACK;
    const json = await res.json();
    const data: GatewayModel[] = json.data ?? json.models ?? json;
    const models = data
      .filter(
        (m) =>
          m.id &&
          m.type === "language" &&
          m.tags?.includes("tool-use"),
      )
      .map((m) => ({ id: m.id, label: m.name ?? m.id }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return models.length ? models : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

export async function isCatalogModel(id: string): Promise<boolean> {
  const models = await fetchGatewayModels();
  return models.some((m) => m.id === id);
}
