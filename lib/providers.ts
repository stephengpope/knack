// Providers supported for bring-your-own-key. The id matches the Gateway
// "provider/" prefix (e.g. "moonshotai/kimi-k2.6" -> provider "moonshotai").

export const PROVIDERS = {
  anthropic: { label: "Anthropic", accent: "#D97757", keyHint: "sk-ant-…", url: "https://console.anthropic.com/settings/keys" },
  openai: { label: "OpenAI", accent: "#10A37F", keyHint: "sk-…", url: "https://platform.openai.com/api-keys" },
  google: { label: "Google", accent: "#4285F4", keyHint: "AIza…", url: "https://aistudio.google.com/apikey" },
  xai: { label: "xAI", accent: "#1A1A1A", keyHint: "xai-…", url: "https://console.x.ai" },
  mistral: { label: "Mistral", accent: "#FF7000", keyHint: "…", url: "https://console.mistral.ai/api-keys" },
  deepseek: { label: "DeepSeek", accent: "#4D6BFE", keyHint: "sk-…", url: "https://platform.deepseek.com/api_keys" },
  moonshotai: { label: "Moonshot (Kimi)", accent: "#6E56CF", keyHint: "sk-…", url: "https://platform.moonshot.ai/console/api-keys" },
} as const;

export type ProviderId = keyof typeof PROVIDERS;

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function isProviderId(x: string): x is ProviderId {
  return x in PROVIDERS;
}

export function providerOf(modelId: string): string {
  const i = modelId.indexOf("/");
  return i === -1 ? "" : modelId.slice(0, i);
}

/**
 * An Anthropic credential is an OAuth/subscription token (Bearer auth) when it
 * starts with `sk-ant-` but is NOT a Console API key (`sk-ant-api…`, x-api-key
 * auth). Same rule hermes uses. Drives the auth header at inference.
 */
export function isAnthropicOAuth(key: string): boolean {
  return key.startsWith("sk-ant-") && !key.startsWith("sk-ant-api");
}

export function providerLabel(modelId: string): string {
  const p = providerOf(modelId);
  if (isProviderId(p)) return PROVIDERS[p].label;
  return p ? p.charAt(0).toUpperCase() + p.slice(1) : "";
}

export function providerAccent(modelId: string): string {
  const p = providerOf(modelId);
  return isProviderId(p) ? PROVIDERS[p].accent : "var(--ink-faint)";
}
