// Client-safe model types + helpers. The actual catalog is fetched live from
// the AI Gateway in lib/gateway-models.ts (server-only).

export type ModelOption = {
  id: string; // gateway "provider/model" string
  label: string; // display name
};

export const DEFAULT_MODEL = "anthropic/claude-opus-4.8";

// Accepts catalog ids AND manual "provider/model" overrides.
const SLUG = /^[a-z0-9.-]+\/[a-z0-9._:-]+$/i;
export function isModelSlug(id: string): boolean {
  return SLUG.test(id);
}
