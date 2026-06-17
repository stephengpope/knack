import "server-only";
import { getAppSettings } from "@/lib/settings";
import { listKeys } from "@/lib/api-keys";
import { listEndpoints } from "@/lib/endpoints";
import { fetchGatewayModels } from "@/lib/gateway-models";
import { type ModelOption } from "@/lib/models";
import { providerOf } from "@/lib/providers";

function pickDefault(models: ModelOption[], saved: string): string {
  return models.some((m) => m.id === saved)
    ? saved
    : (models[0]?.id ?? saved);
}

/**
 * Models available to every user, given the shared connection mode:
 * - gateway: the full live catalog (deployment's gateway key)
 * - custom: catalog filtered to providers with a stored key (gateway BYOK)
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

  const [keys, catalog] = await Promise.all([
    listKeys(),
    fetchGatewayModels(),
  ]);

  if (settings.connectionMode === "gateway") {
    return { models: catalog, defaultModel: settings.defaultModel, gateway: true };
  }

  const have = new Set<string>(keys.map((k) => k.provider));
  const models = catalog.filter((m) => have.has(providerOf(m.id)));
  return {
    models,
    defaultModel: pickDefault(models, settings.defaultModel),
    gateway: false,
  };
}
