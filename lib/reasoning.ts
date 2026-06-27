import "server-only";
import { providerOf } from "@/lib/providers";
import type { ConnectionMode, ReasoningEffort } from "@/lib/settings";

// Fallback reasoning-capable families, matched by id prefix. The catalog
// (models.dev) is the primary source — see modelSupportsReasoning. This covers
// ids the registry doesn't carry: gateway dot-slugs and offline.
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

/** Family-allowlist reasoning check — the fallback when the registry lacks an id. */
export function isReasoningFamily(provider: string, id: string): boolean {
  const prefixes = REASONING_PREFIXES[provider];
  if (!prefixes) return false;
  const lid = id.toLowerCase();
  return prefixes.some((p) => lid.startsWith(p));
}

function splitModel(modelId: string): { provider: string; id: string } {
  const provider = providerOf(modelId);
  const i = modelId.indexOf("/");
  return { provider, id: i === -1 ? modelId : modelId.slice(i + 1) };
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
 * when off / the model isn't reasoning-capable / no provider knob. `capable` is
 * the registry-backed capability for this model (see modelSupportsReasoning);
 * gating lives with the caller so this stays a pure, synchronous mapper. Shared
 * by custom + gateway (the gateway forwards providerOptions untouched);
 * compatible is endpoint-specific and opt-in, so it returns undefined.
 */
export function reasoningOptionsFor(
  mode: ConnectionMode,
  modelId: string,
  effort: ReasoningEffort,
  capable: boolean,
): Record<string, unknown> | undefined {
  if (effort === "off") return undefined;
  if (mode === "compatible") return undefined;
  if (!capable) return undefined;
  const { provider } = splitModel(modelId);

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
