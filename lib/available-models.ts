import "server-only";
import { getAppSettings } from "@/lib/settings";
import { getKeyMap } from "@/lib/api-keys";
import { listEndpoints } from "@/lib/endpoints";
import { fetchGatewayModels } from "@/lib/gateway-models";
import { fetchProviderModels } from "@/lib/provider-models";
import { type ModelOption } from "@/lib/models";
import { type ProviderId } from "@/lib/providers";

function pickDefault(models: ModelOption[], saved: string): string {
  return models.some((m) => m.id === saved)
    ? saved
    : (models[0]?.id ?? saved);
}

/**
 * Models available to every user, given the shared connection mode:
 * - gateway: the full live catalog (deployment's gateway key)
 * - custom: each stored provider's own /models list, called directly with your
 *   key (no gateway), ids in native `provider/model` form
 * - compatible: the saved OpenAI-compatible endpoints (direct)
 */
export async function getAvailableModels(): Promise<{
  models: ModelOption[];
  defaultModel: string;
  gateway: boolean;
}> {
  const settings = await getAppSettings();

  if (settings.connectionMode === "compatible") {
    const endpoints = await listEndpoints();
    const models = endpoints.map((e) => ({ id: e.id, label: e.name }));
    return {
      models,
      defaultModel: pickDefault(models, settings.defaultModel),
      gateway: false,
    };
  }

  if (settings.connectionMode === "gateway") {
    const catalog = await fetchGatewayModels();
    return { models: catalog, defaultModel: settings.defaultModel, gateway: true };
  }

  // custom: list directly from each provider that has a stored key.
  const keyMap = await getKeyMap();
  const lists = await Promise.all(
    (Object.keys(keyMap) as ProviderId[]).map((p) =>
      fetchProviderModels(p, keyMap[p]!),
    ),
  );
  const models = lists.flat();
  return {
    models,
    defaultModel: pickDefault(models, settings.defaultModel),
    gateway: false,
  };
}
