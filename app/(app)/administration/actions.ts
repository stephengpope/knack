"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { setKey, deleteKey } from "@/lib/api-keys";
import { setConnectionMode, setDefaultModel } from "@/lib/settings";
import { isProviderId } from "@/lib/providers";
import { MODELS_CACHE_TAG } from "@/lib/gateway-models";
import { addEndpoint, deleteEndpoint } from "@/lib/endpoints";

export async function setKeyAction(provider: string, key: string) {
  await requireAdmin();
  if (!isProviderId(provider)) throw new Error("Unknown provider");
  const value = key.trim();
  if (!value) throw new Error("Empty key");
  await setKey(provider, value);
  revalidatePath("/administration");
}

export async function deleteKeyAction(provider: string) {
  await requireAdmin();
  if (!isProviderId(provider)) throw new Error("Unknown provider");
  await deleteKey(provider);
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

export async function refreshModelsAction() {
  await requireAdmin();
  revalidateTag(MODELS_CACHE_TAG, "seconds");
  revalidatePath("/administration");
}
