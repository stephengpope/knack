"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  createStaticSecret,
  upsertStaticSecret,
  createOAuthConnection,
  getConnectionSecret,
  disconnectOAuth,
  deleteSecret,
} from "@/lib/user-secrets";
import {
  getPreset,
  resolveProviderConfig,
  buildClient,
  buildAuthorization,
  oauthRedirectUri,
} from "@/lib/oauth/providers";

const NAME_RE = /^[\w.-]{1,64}$/;

function assertName(name: string) {
  if (!NAME_RE.test(name)) {
    throw new Error(
      "Name must be 1–64 chars: letters, numbers, dot, dash, underscore.",
    );
  }
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function friendlyDbError(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes("user_secret_user_name_idx") || msg.includes("duplicate")) {
    return new Error("A secret with that name already exists.");
  }
  return e instanceof Error ? e : new Error(msg);
}

export async function addStaticSecretAction(input: {
  name: string;
  description?: string;
  value: string;
}): Promise<void> {
  const user = await requireUser();
  const name = input.name.trim();
  assertName(name);
  if (!input.value.trim()) throw new Error("Value is required.");
  try {
    await createStaticSecret(user.id, {
      name,
      description: input.description,
      value: input.value,
    });
  } catch (e) {
    throw friendlyDbError(e);
  }
  revalidatePath("/settings");
}

/**
 * Create or replace a static token by name (upsert). Used to set or override a
 * built-in / global token from the Secrets tab.
 */
export async function setStaticSecretAction(input: {
  name: string;
  value: string;
  description?: string;
}): Promise<void> {
  const user = await requireUser();
  const name = input.name.trim();
  assertName(name);
  if (!input.value.trim()) throw new Error("Value is required.");
  try {
    await upsertStaticSecret(user.id, {
      name,
      value: input.value,
      description: input.description,
    });
  } catch (e) {
    throw friendlyDbError(e);
  }
  revalidatePath("/settings");
}

export async function addOAuthConnectionAction(input: {
  name: string;
  description?: string;
  provider: string;
  clientId: string;
  clientSecret: string;
  authUrl?: string;
  tokenUrl?: string;
  scopes: string[];
}): Promise<{ id: string }> {
  const user = await requireUser();
  const name = input.name.trim();
  assertName(name);

  const preset = getPreset(input.provider);
  if (!preset) throw new Error("Unknown provider.");
  if (!input.clientId.trim() || !input.clientSecret.trim()) {
    throw new Error("Client ID and client secret are required.");
  }
  if (preset.custom) {
    if (!isHttpUrl(input.authUrl ?? "") || !isHttpUrl(input.tokenUrl ?? "")) {
      throw new Error("Valid authorization and token URLs are required.");
    }
  }
  const scopes = input.scopes.map((s) => s.trim()).filter(Boolean);

  let id: string;
  try {
    id = await createOAuthConnection(user.id, {
      name,
      description: input.description,
      provider: input.provider,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      authUrl: input.authUrl,
      tokenUrl: input.tokenUrl,
      scopes,
    });
  } catch (e) {
    throw friendlyDbError(e);
  }
  revalidatePath("/settings");
  return { id };
}

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 600, // 10 min to complete consent
};

/** Begin (or re-do) the OAuth dance: stash state+PKCE, return the consent URL. */
export async function startConnectAction(id: string): Promise<{ url: string }> {
  const user = await requireUser();
  const conn = await getConnectionSecret(user.id, id);
  if (!conn) throw new Error("Connection not found.");

  const cfg = resolveProviderConfig(conn.row);
  const client = buildClient({
    clientId: conn.row.clientId ?? "",
    clientSecret: conn.clientSecret,
    redirectUri: await oauthRedirectUri(),
  });
  const { url, state, codeVerifier } = buildAuthorization(cfg, client);

  const jar = await cookies();
  jar.set("oauth_state", state, COOKIE_OPTS);
  jar.set("oauth_verifier", codeVerifier, COOKIE_OPTS);
  jar.set("oauth_cid", id, COOKIE_OPTS);

  return { url: url.toString() };
}

export async function disconnectAction(id: string): Promise<void> {
  const user = await requireUser();
  await disconnectOAuth(user.id, id);
  revalidatePath("/settings");
}

export async function deleteSecretAction(id: string): Promise<void> {
  const user = await requireUser();
  await deleteSecret(user.id, id);
  revalidatePath("/settings");
}
