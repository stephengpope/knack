import "server-only";
import { type ModelOption } from "@/lib/models";
import { type ProviderId } from "@/lib/providers";

/**
 * Direct-provider model lists for "provide your own keys" (custom) mode.
 *
 * Completely separate from `lib/gateway-models.ts`: this uses the deployment's
 * stored *provider* key (never the gateway key) and hits each provider's own
 * `/models` endpoint, so the ids returned are the provider's native ids — no
 * gateway-slug translation. Cached in the Next Data Cache for 24h with a
 * per-provider tag, so adding a key (which revalidates that tag) refetches just
 * that provider. Failures are isolated per provider (a bad/expired key yields an
 * empty list, not a broken picker).
 *
 * Only providers with a first-party AI SDK package appear here. A provider
 * without an entry (e.g. Moonshot) simply isn't offered in direct mode — those
 * go through the OpenAI-compatible connection mode instead.
 */

export const providerModelsTag = (p: ProviderId) => `provider-models:${p}`;

type ProviderModelsResponse = {
  data?: { id: string }[]; // OpenAI-shaped (OpenAI, xAI, Mistral, DeepSeek, Anthropic)
  models?: { name: string }[]; // Google-shaped
};

type Source = {
  url: string;
  headers: (key: string) => Record<string, string>;
  parse: (json: ProviderModelsResponse) => string[]; // -> bare native ids
};

// Endpoint config per provider — stable provider-API surface, NOT a curated
// model list. No capability filtering: the full list is surfaced and a model
// the agent can't use simply errors at call time.
const SOURCES: Partial<Record<ProviderId, Source>> = {
  openai: {
    url: "https://api.openai.com/v1/models",
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
    parse: (j) => (j.data ?? []).map((m) => m.id),
  },
  anthropic: {
    url: "https://api.anthropic.com/v1/models",
    headers: (k) => ({ "x-api-key": k, "anthropic-version": "2023-06-01" }),
    parse: (j) => (j.data ?? []).map((m) => m.id),
  },
  google: {
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    headers: (k) => ({ "x-goog-api-key": k }),
    parse: (j) => (j.models ?? []).map((m) => m.name.replace(/^models\//, "")),
  },
  xai: {
    url: "https://api.x.ai/v1/models",
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
    parse: (j) => (j.data ?? []).map((m) => m.id),
  },
  mistral: {
    url: "https://api.mistral.ai/v1/models",
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
    parse: (j) => (j.data ?? []).map((m) => m.id),
  },
  deepseek: {
    url: "https://api.deepseek.com/models",
    headers: (k) => ({ Authorization: `Bearer ${k}` }),
    parse: (j) => (j.data ?? []).map((m) => m.id),
  },
};

/**
 * Native model ids for one provider, prefixed back into the `provider/model`
 * shape the rest of the app routes on (`providerOf`, the picker, `build`).
 * Returns `[]` for any provider without a direct SDK package or on any error.
 */
export async function fetchProviderModels(
  provider: ProviderId,
  apiKey: string,
): Promise<ModelOption[]> {
  const src = SOURCES[provider];
  if (!src) return []; // no direct SDK (e.g. Moonshot) — not offered here
  try {
    const res = await fetch(src.url, {
      headers: src.headers(apiKey),
      next: { revalidate: 86400, tags: [providerModelsTag(provider)] },
    });
    if (!res.ok) return [];
    const ids = src.parse((await res.json()) as ProviderModelsResponse);
    return ids
      .sort()
      .map((id) => ({ id: `${provider}/${id}`, label: id }));
  } catch {
    return [];
  }
}
