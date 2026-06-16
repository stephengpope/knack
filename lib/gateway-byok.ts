import "server-only";
import { getUserKeyMap } from "@/lib/api-keys";

/**
 * Build request-scoped BYOK providerOptions from the user's stored keys.
 * When the user has a key for a model's provider, the Gateway routes the
 * request through their credentials; otherwise it falls back to the hosted
 * (system) credentials. Single model namespace either way — always gateway slugs.
 *
 * Returns a JSON-clean object compatible with AI SDK `providerOptions`.
 */
export async function gatewayByokOptions(userId: string) {
  const map = await getUserKeyMap(userId);
  const byok: Record<string, { apiKey: string }[]> = {};
  for (const [provider, apiKey] of Object.entries(map)) {
    if (apiKey) byok[provider] = [{ apiKey }];
  }
  if (Object.keys(byok).length === 0) return undefined;
  return { gateway: { byok } };
}
