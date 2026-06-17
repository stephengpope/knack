import "server-only";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { OAuth2Tokens } from "arctic";
import { db } from "@/lib/db";
import { userSecret, type UserSecret } from "@/lib/db/schema";
import { encrypt, decrypt } from "@/lib/crypto";
import {
  buildClient,
  resolveProviderConfig,
  refreshTokens,
  oauthRedirectUri,
  emailFromIdToken,
} from "@/lib/oauth/providers";

export type SecretKind = "static" | "oauth";
export type OAuthStatus = "disconnected" | "connected" | "expired";

// Masked view for the UI and the agent's `list_tokens` — never any value.
export type SecretSummary = {
  id: string;
  name: string;
  description: string | null;
  kind: SecretKind;
  // oauth-only
  provider: string | null;
  accountEmail: string | null;
  scopes: string[] | null;
  status: OAuthStatus | null;
};

function toSummary(r: UserSecret): SecretSummary {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    kind: r.kind as SecretKind,
    provider: r.provider,
    accountEmail: r.accountEmail,
    scopes: r.scopes ?? null,
    status: (r.status as OAuthStatus | null) ?? null,
  };
}

export async function listSecrets(userId: string): Promise<SecretSummary[]> {
  const rows = await db
    .select()
    .from(userSecret)
    .where(eq(userSecret.userId, userId));
  return rows
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(toSummary);
}

async function ownedRow(
  userId: string,
  id: string,
): Promise<UserSecret | null> {
  const [row] = await db
    .select()
    .from(userSecret)
    .where(and(eq(userSecret.userId, userId), eq(userSecret.id, id)))
    .limit(1);
  return row ?? null;
}

/* ---------------------------------- static --------------------------------- */

export async function createStaticSecret(
  userId: string,
  input: { name: string; description?: string; value: string },
): Promise<void> {
  await db.insert(userSecret).values({
    id: nanoid(),
    userId,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    kind: "static",
    encryptedValue: encrypt(input.value),
  });
}

export async function updateStaticValue(
  userId: string,
  id: string,
  value: string,
): Promise<void> {
  await db
    .update(userSecret)
    .set({ encryptedValue: encrypt(value), updatedAt: new Date() })
    .where(
      and(
        eq(userSecret.userId, userId),
        eq(userSecret.id, id),
        eq(userSecret.kind, "static"),
      ),
    );
}

/* ---------------------------------- oauth ---------------------------------- */

export async function createOAuthConnection(
  userId: string,
  input: {
    name: string;
    description?: string;
    provider: string;
    clientId: string;
    clientSecret: string;
    authUrl?: string;
    tokenUrl?: string;
    scopes: string[];
  },
): Promise<string> {
  const id = nanoid();
  await db.insert(userSecret).values({
    id,
    userId,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    kind: "oauth",
    provider: input.provider,
    clientId: input.clientId.trim(),
    encryptedClientSecret: encrypt(input.clientSecret),
    authUrl: input.authUrl?.trim() || null,
    tokenUrl: input.tokenUrl?.trim() || null,
    scopes: input.scopes,
    status: "disconnected",
  });
  return id;
}

/** Connection + decrypted client secret, for starting/finishing the flow. */
export async function getConnectionSecret(
  userId: string,
  id: string,
): Promise<{ row: UserSecret; clientSecret: string } | null> {
  const row = await ownedRow(userId, id);
  if (!row || row.kind !== "oauth" || !row.encryptedClientSecret) return null;
  return { row, clientSecret: decrypt(row.encryptedClientSecret) };
}

/** Persist a freshly-granted token set (preserves refresh token if omitted). */
export async function storeOAuthTokens(
  userId: string,
  id: string,
  tokens: OAuth2Tokens,
): Promise<void> {
  const accessToken = tokens.accessToken();
  let refreshEnc: string | undefined;
  if (tokens.hasRefreshToken()) refreshEnc = encrypt(tokens.refreshToken());

  let expiresAt: Date | null = null;
  try {
    expiresAt = tokens.accessTokenExpiresAt();
  } catch {
    expiresAt = null; // provider didn't return an expiry (treated as long-lived)
  }
  let tokenType: string | null = null;
  try {
    tokenType = tokens.tokenType();
  } catch {
    tokenType = null;
  }
  let granted: string[] | undefined;
  try {
    if (tokens.hasScopes()) granted = tokens.scopes();
  } catch {
    granted = undefined;
  }
  let idToken: string | null = null;
  try {
    idToken = tokens.idToken();
  } catch {
    idToken = null;
  }
  const email = emailFromIdToken(idToken);

  await db
    .update(userSecret)
    .set({
      encryptedAccessToken: encrypt(accessToken),
      ...(refreshEnc ? { encryptedRefreshToken: refreshEnc } : {}),
      accessTokenExpiresAt: expiresAt,
      tokenType,
      ...(granted ? { scopes: granted } : {}),
      ...(email ? { accountEmail: email } : {}),
      status: "connected",
      updatedAt: new Date(),
    })
    .where(and(eq(userSecret.userId, userId), eq(userSecret.id, id)));
}

/** Clear the granted tokens but keep the connection config (for re-auth). */
export async function disconnectOAuth(
  userId: string,
  id: string,
): Promise<void> {
  await db
    .update(userSecret)
    .set({
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
      accessTokenExpiresAt: null,
      accountEmail: null,
      status: "disconnected",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(userSecret.userId, userId),
        eq(userSecret.id, id),
        eq(userSecret.kind, "oauth"),
      ),
    );
}

export async function deleteSecret(userId: string, id: string): Promise<void> {
  await db
    .delete(userSecret)
    .where(and(eq(userSecret.userId, userId), eq(userSecret.id, id)));
}

/* --------------------------- agent-facing resolve -------------------------- */

const EXPIRY_SKEW_MS = 60_000;

class NeedsReauthError extends Error {
  constructor(name: string) {
    super(`needs re-auth: ${name}`);
    this.name = "NeedsReauthError";
  }
}

/**
 * Resolve a usable credential string by name for the given user.
 * - static → the stored value
 * - oauth  → a fresh access token (refreshed on demand)
 * Throws if the name is unknown or an OAuth connection needs re-auth.
 */
export async function getToken(userId: string, name: string): Promise<string> {
  const [row] = await db
    .select()
    .from(userSecret)
    .where(and(eq(userSecret.userId, userId), eq(userSecret.name, name)))
    .limit(1);
  if (!row) throw new Error(`No secret named "${name}"`);

  if (row.kind === "static") {
    if (!row.encryptedValue) throw new Error(`Secret "${name}" has no value`);
    return decrypt(row.encryptedValue);
  }

  // oauth
  if (row.status !== "connected" || !row.encryptedAccessToken) {
    throw new NeedsReauthError(name);
  }

  const expiresAt = row.accessTokenExpiresAt;
  const needsRefresh =
    !!expiresAt && expiresAt.getTime() - EXPIRY_SKEW_MS <= Date.now();

  if (!needsRefresh) return decrypt(row.encryptedAccessToken);

  // expired/expiring: refresh if we can, else flag for re-auth
  if (!row.encryptedRefreshToken) {
    await markExpired(userId, row.id);
    throw new NeedsReauthError(name);
  }
  try {
    const cfg = resolveProviderConfig(row);
    const client = buildClient({
      clientId: row.clientId ?? "",
      clientSecret: decrypt(row.encryptedClientSecret ?? ""),
      redirectUri: await oauthRedirectUri(),
    });
    const tokens = await refreshTokens(
      cfg,
      client,
      decrypt(row.encryptedRefreshToken),
    );
    await storeOAuthTokens(userId, row.id, tokens);
    return tokens.accessToken();
  } catch {
    await markExpired(userId, row.id);
    throw new NeedsReauthError(name);
  }
}

async function markExpired(userId: string, id: string): Promise<void> {
  await db
    .update(userSecret)
    .set({ status: "expired", updatedAt: new Date() })
    .where(and(eq(userSecret.userId, userId), eq(userSecret.id, id)));
}
