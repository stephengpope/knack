import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { userSettings } from "@/lib/db/schema";
import { DEFAULT_MODEL } from "@/lib/models";

export type ConnectionMode = "gateway" | "custom" | "compatible";

export type Settings = {
  connectionMode: ConnectionMode;
  defaultModel: string;
};

const FALLBACK: Settings = {
  connectionMode: "gateway",
  defaultModel: DEFAULT_MODEL,
};

export async function getUserSettings(userId: string): Promise<Settings> {
  const [row] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.userId, userId))
    .limit(1);
  if (!row) return FALLBACK;
  return {
    connectionMode: (row.connectionMode as ConnectionMode) ?? "gateway",
    defaultModel: row.defaultModel ?? DEFAULT_MODEL,
  };
}

async function upsert(userId: string, patch: Partial<Settings>) {
  const current = await getUserSettings(userId);
  const next = { ...current, ...patch };
  await db
    .insert(userSettings)
    .values({
      userId,
      connectionMode: next.connectionMode,
      defaultModel: next.defaultModel,
    })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: {
        connectionMode: next.connectionMode,
        defaultModel: next.defaultModel,
        updatedAt: new Date(),
      },
    });
}

export async function setConnectionMode(userId: string, mode: ConnectionMode) {
  await upsert(userId, { connectionMode: mode });
}

export async function setDefaultModel(userId: string, model: string) {
  await upsert(userId, { defaultModel: model });
}
