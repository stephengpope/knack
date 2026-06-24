import "server-only";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { globalSecret } from "@/lib/db/schema";
import { encrypt, decrypt } from "@/lib/crypto";

// Masked view for the UI — never the value, only last4 for display.
export type GlobalSecretSummary = {
  name: string;
  description: string | null;
  last4: string;
};

export async function globalSecretsList(): Promise<GlobalSecretSummary[]> {
  const rows = await db
    .select({
      name: globalSecret.name,
      description: globalSecret.description,
      last4: globalSecret.last4,
    })
    .from(globalSecret);
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** Upsert a global token by name (admin-managed). */
export async function setGlobalSecret(
  name: string,
  value: string,
  description?: string,
): Promise<void> {
  const trimmed = name.trim();
  await db
    .insert(globalSecret)
    .values({
      id: nanoid(),
      name: trimmed,
      description: description?.trim() || null,
      encrypted: encrypt(value),
      last4: value.slice(-4),
    })
    .onConflictDoUpdate({
      target: globalSecret.name,
      set: {
        encrypted: encrypt(value),
        last4: value.slice(-4),
        ...(description !== undefined
          ? { description: description.trim() || null }
          : {}),
        updatedAt: new Date(),
      },
    });
}

export async function deleteGlobalSecret(name: string): Promise<void> {
  await db.delete(globalSecret).where(eq(globalSecret.name, name.trim()));
}

/** Decrypt a global token value. Internal — resolution layer only. */
export async function getGlobalSecretValue(
  name: string,
): Promise<string | null> {
  const [row] = await db
    .select({ encrypted: globalSecret.encrypted })
    .from(globalSecret)
    .where(eq(globalSecret.name, name))
    .limit(1);
  return row ? decrypt(row.encrypted) : null;
}
