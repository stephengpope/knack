import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { customEndpoint } from "@/lib/db/schema";
import { encrypt, decrypt } from "@/lib/crypto";

export type EndpointInfo = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
};

/** User's endpoints without secrets (for UI + model list). */
export async function listEndpoints(userId: string): Promise<EndpointInfo[]> {
  return db
    .select({
      id: customEndpoint.id,
      name: customEndpoint.name,
      baseUrl: customEndpoint.baseUrl,
      model: customEndpoint.model,
    })
    .from(customEndpoint)
    .where(eq(customEndpoint.userId, userId))
    .orderBy(asc(customEndpoint.createdAt));
}

export async function addEndpoint(
  userId: string,
  data: { name: string; baseUrl: string; apiKey: string; model: string },
): Promise<string> {
  const id = nanoid();
  await db.insert(customEndpoint).values({
    id,
    userId,
    name: data.name.trim(),
    baseUrl: data.baseUrl.trim(),
    encrypted: encrypt(data.apiKey.trim()),
    model: data.model.trim(),
  });
  return id;
}

export async function deleteEndpoint(userId: string, id: string) {
  await db
    .delete(customEndpoint)
    .where(and(eq(customEndpoint.id, id), eq(customEndpoint.userId, userId)));
}

/** Resolve one endpoint with its decrypted key — agent route only. */
export async function getEndpointWithKey(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(customEndpoint)
    .where(and(eq(customEndpoint.id, id), eq(customEndpoint.userId, userId)))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    model: row.model,
    apiKey: decrypt(row.encrypted),
  };
}
