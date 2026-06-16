import "server-only";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { apiKey } from "@/lib/db/schema";
import { encrypt, decrypt } from "@/lib/crypto";
import { isProviderId, type ProviderId } from "@/lib/providers";

export type KeyInfo = { provider: ProviderId; last4: string };

/** Masked list of which providers the user has configured (no secrets). */
export async function listUserKeys(userId: string): Promise<KeyInfo[]> {
  const rows = await db
    .select({ provider: apiKey.provider, last4: apiKey.last4 })
    .from(apiKey)
    .where(eq(apiKey.userId, userId));
  return rows.filter((r): r is KeyInfo => isProviderId(r.provider));
}

/** Decrypted provider -> key map, for the agent route only. */
export async function getUserKeyMap(
  userId: string,
): Promise<Partial<Record<ProviderId, string>>> {
  const rows = await db
    .select({ provider: apiKey.provider, encrypted: apiKey.encrypted })
    .from(apiKey)
    .where(eq(apiKey.userId, userId));
  const map: Partial<Record<ProviderId, string>> = {};
  for (const r of rows) {
    if (!isProviderId(r.provider)) continue;
    try {
      map[r.provider] = decrypt(r.encrypted);
    } catch {
      // skip undecryptable (e.g. key rotated)
    }
  }
  return map;
}

export async function setUserKey(
  userId: string,
  provider: ProviderId,
  rawKey: string,
) {
  const value = rawKey.trim();
  const last4 = value.slice(-4);
  const encrypted = encrypt(value);
  await db
    .insert(apiKey)
    .values({ id: nanoid(), userId, provider, encrypted, last4 })
    .onConflictDoUpdate({
      target: [apiKey.userId, apiKey.provider],
      set: { encrypted, last4, updatedAt: new Date() },
    });
}

export async function deleteUserKey(userId: string, provider: ProviderId) {
  await db
    .delete(apiKey)
    .where(and(eq(apiKey.userId, userId), eq(apiKey.provider, provider)));
}
