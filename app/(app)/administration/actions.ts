"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { setKey, deleteKey } from "@/lib/api-keys";
import {
  setConnectionMode,
  setDefaultModel,
  setGeneralModel,
  setVoiceKey,
  deleteVoiceKey,
} from "@/lib/settings";
import { isProviderId, PROVIDER_IDS } from "@/lib/providers";
import { MODELS_CACHE_TAG } from "@/lib/gateway-models";
import { providerModelsTag } from "@/lib/provider-models";
import { addEndpoint, deleteEndpoint } from "@/lib/endpoints";
import { setGlobalSecret, deleteGlobalSecret } from "@/lib/global-secrets";

const TOKEN_NAME_RE = /^[\w.-]{1,64}$/;

export async function setKeyAction(provider: string, key: string) {
  await requireAdmin();
  if (!isProviderId(provider)) throw new Error("Unknown provider");
  const value = key.trim();
  if (!value) throw new Error("Empty key");
  await setKey(provider, value);
  revalidateTag(providerModelsTag(provider), "seconds"); // refetch this provider's models
  revalidatePath("/administration");
}

export async function deleteKeyAction(provider: string) {
  await requireAdmin();
  if (!isProviderId(provider)) throw new Error("Unknown provider");
  await deleteKey(provider);
  revalidateTag(providerModelsTag(provider), "seconds");
  revalidatePath("/administration");
}

export async function setConnectionModeAction(
  mode: "gateway" | "custom" | "compatible",
) {
  await requireAdmin();
  await setConnectionMode(mode);
  revalidatePath("/administration");
}

export async function addEndpointAction(data: {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}) {
  await requireAdmin();
  if (!data.name.trim() || !data.baseUrl.trim() || !data.model.trim()) {
    throw new Error("Name, base URL and model are required");
  }
  await addEndpoint(data);
  revalidatePath("/administration");
}

export async function deleteEndpointAction(id: string) {
  await requireAdmin();
  await deleteEndpoint(id);
  revalidatePath("/administration");
}

export async function setDefaultModelAction(model: string) {
  await requireAdmin();
  // model may be a gateway "provider/model" slug or a custom-endpoint id;
  // validity per connection mode is enforced in the agent route.
  if (!model.trim()) throw new Error("No model selected");
  await setDefaultModel(model);
  revalidatePath("/administration");
}

export async function setGeneralModelAction(model: string | null) {
  await requireAdmin();
  // null clears it back to "Same as AI Agent"; validity per connection mode is
  // enforced when the model is resolved (lib/llm.ts).
  await setGeneralModel(model);
  revalidatePath("/administration");
}

export async function setVoiceKeyAction(key: string) {
  await requireAdmin();
  const value = key.trim();
  if (!value) throw new Error("Empty key");
  await setVoiceKey(value);
  revalidatePath("/administration");
}

export async function deleteVoiceKeyAction() {
  await requireAdmin();
  await deleteVoiceKey();
  revalidatePath("/administration");
}

export async function setGlobalTokenAction(
  name: string,
  value: string,
  description?: string,
) {
  await requireAdmin();
  const trimmed = name.trim();
  if (!TOKEN_NAME_RE.test(trimmed)) {
    throw new Error(
      "Name must be 1–64 chars: letters, numbers, dot, dash, underscore",
    );
  }
  if (!value.trim()) throw new Error("Empty value");
  await setGlobalSecret(trimmed, value, description);
  revalidatePath("/administration");
}

export async function deleteGlobalTokenAction(name: string) {
  await requireAdmin();
  await deleteGlobalSecret(name);
  revalidatePath("/administration");
}

export async function refreshModelsAction() {
  await requireAdmin();
  revalidateTag(MODELS_CACHE_TAG, "seconds"); // gateway catalog
  for (const p of PROVIDER_IDS) {
    revalidateTag(providerModelsTag(p), "seconds"); // direct-mode provider lists
  }
  revalidatePath("/administration");
}
