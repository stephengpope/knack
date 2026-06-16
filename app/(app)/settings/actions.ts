"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { getSession } from "@/lib/session";
import { setUserKey, deleteUserKey } from "@/lib/api-keys";
import { setConnectionMode, setDefaultModel } from "@/lib/settings";
import { isProviderId } from "@/lib/providers";
import { MODELS_CACHE_TAG } from "@/lib/gateway-models";
import { addEndpoint, deleteEndpoint } from "@/lib/endpoints";

async function requireUser() {
  const session = await getSession();
  if (!session?.user) throw new Error("Unauthorized");
  return session.user.id;
}

export async function setKeyAction(provider: string, key: string) {
  if (!isProviderId(provider)) throw new Error("Unknown provider");
  const value = key.trim();
  if (!value) throw new Error("Empty key");
  await setUserKey(await requireUser(), provider, value);
  revalidatePath("/settings");
}

export async function deleteKeyAction(provider: string) {
  if (!isProviderId(provider)) throw new Error("Unknown provider");
  await deleteUserKey(await requireUser(), provider);
  revalidatePath("/settings");
}

export async function setConnectionModeAction(
  mode: "gateway" | "custom" | "compatible",
) {
  await setConnectionMode(await requireUser(), mode);
  revalidatePath("/settings");
}

export async function addEndpointAction(data: {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}) {
  const userId = await requireUser();
  if (!data.name.trim() || !data.baseUrl.trim() || !data.model.trim()) {
    throw new Error("Name, base URL and model are required");
  }
  await addEndpoint(userId, data);
  revalidatePath("/settings");
}

export async function deleteEndpointAction(id: string) {
  await deleteEndpoint(await requireUser(), id);
  revalidatePath("/settings");
}

export async function setDefaultModelAction(model: string) {
  // model may be a gateway "provider/model" slug or a custom-endpoint id;
  // validity per connection mode is enforced in the agent route.
  if (!model.trim()) throw new Error("No model selected");
  await setDefaultModel(await requireUser(), model);
  revalidatePath("/settings");
}

export async function refreshModelsAction() {
  await requireUser();
  revalidateTag(MODELS_CACHE_TAG, "seconds");
  revalidatePath("/settings");
}
