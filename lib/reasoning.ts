import "server-only";
import { providerOf } from "@/lib/providers";
import type { ConnectionMode, ReasoningEffort } from "@/lib/settings";

// Reasoning-capable model families, matched by native-id / gateway-slug prefix.
// Capability can't be detected reliably, so — like hermes — we allowlist known
// families. Anything not listed (e.g. deepseek-v4-flash, haiku) gets no
// reasoning options, making the setting a safe no-op there.
const REASONING_PREFIXES: Record<string, string[]> = {
  anthropic: [
    "claude-opus-4",
    "claude-sonnet-4-5",
    "claude-sonnet-4-6",
    "claude-fable-5",
    "claude-mythos-5",
  ],
  openai: ["o1", "o3", "o4", "gpt-5"],
  xai: ["grok-4", "grok-3-mini"],
  google: ["gemini-2.5", "gemini-3", "gemini-2.0-flash-thinking"],
  deepseek: ["deepseek-reasoner", "deepseek-r"],
};

// Both custom ("provider/<native-id>", dashes) and gateway ("provider/model"
// slug, dots) split on the first "/". The native id keeps any remaining dots.
function splitModel(modelId: string): { provider: string; id: string } {
  const provider = providerOf(modelId);
  const i = modelId.indexOf("/");
  return { provider, id: i === -1 ? modelId : modelId.slice(i + 1) };
}

function isReasoningModel(provider: string, id: string): boolean {
  const prefixes = REASONING_PREFIXES[provider];
  if (!prefixes) return false;
  const lid = id.toLowerCase();
  return prefixes.some((p) => lid.startsWith(p));
}

type Level = Exclude<ReasoningEffort, "off">;

// openai/xai/deepseek `reasoningEffort` enums don't have "max"; clamp to "high".
function enumEffort(e: Level): string {
  return e === "max" ? "high" : e;
}

// Google takes a thinking-token budget, not an effort enum — translate.
const GOOGLE_BUDGET: Record<Level, number> = {
  low: 2048,
  medium: 8192,
  high: 16384,
  max: 24576,
};

/**
 * Provider-keyed reasoning `providerOptions` for the AGENT turn, or undefined
 * when reasoning is off, the model isn't reasoning-capable, or the provider has
 * no knob. Shared by `custom` and `gateway` (the gateway forwards
 * providerOptions untouched). `compatible` is endpoint-dependent — the endpoint
 * may ignore or reject `reasoning_effort`, and capability can't be detected — so
 * it's left to per-endpoint opt-in and returns undefined here.
 */
export function reasoningOptionsFor(
  mode: ConnectionMode,
  modelId: string,
  effort: ReasoningEffort,
): Record<string, unknown> | undefined {
  if (effort === "off") return undefined;
  if (mode === "compatible") return undefined;
  const { provider, id } = splitModel(modelId);
  if (!isReasoningModel(provider, id)) return undefined;

  switch (provider) {
    case "anthropic":
      return {
        anthropic: {
          thinking: { type: "adaptive", display: "summarized" },
          effort, // low|medium|high|max all valid on anthropic
          sendReasoning: true,
        },
      };
    case "openai":
      return { openai: { reasoningEffort: enumEffort(effort) } };
    case "xai":
      return { xai: { reasoningEffort: enumEffort(effort) } };
    case "deepseek":
      return { deepseek: { reasoningEffort: enumEffort(effort) } };
    case "google":
      return {
        google: {
          thinkingConfig: {
            includeThoughts: true,
            thinkingBudget: GOOGLE_BUDGET[effort],
          },
        },
      };
    default:
      return undefined;
  }
}
