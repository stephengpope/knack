import "server-only";
import { getKeyMap } from "@/lib/api-keys";

/**
 * Build request-scoped BYOK providerOptions from the deployment's stored keys.
 * When a key exists for a model's provider, the Gateway routes the request
 * through those credentials; otherwise it falls back to the hosted (system)
 * credentials. Single model namespace either way — always gateway slugs.
 *
 * Returns a JSON-clean object compatible with AI SDK `providerOptions`.
 */
export async function gatewayByokOptions() {
  const map = await getKeyMap();
  const byok: Record<string, { apiKey: string }[]> = {};
  for (const [provider, apiKey] of Object.entries(map)) {
    if (apiKey) byok[provider] = [{ apiKey }];
  }
  if (Object.keys(byok).length === 0) return undefined;
  return { gateway: { byok } };
}
