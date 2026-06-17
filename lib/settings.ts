import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { DEFAULT_MODEL } from "@/lib/models";

export type ConnectionMode = "gateway" | "custom" | "compatible";

export type Settings = {
  connectionMode: ConnectionMode;
  defaultModel: string;
};

// Singleton row id — the deployment shares one config.
const APP_ID = "app";

const FALLBACK: Settings = {
  connectionMode: "gateway",
  defaultModel: DEFAULT_MODEL,
};

/** Shared deployment model config (admin-managed, used by every user). */
export async function getAppSettings(): Promise<Settings> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, APP_ID))
    .limit(1);
  if (!row) return FALLBACK;
  return {
    connectionMode: (row.connectionMode as ConnectionMode) ?? "gateway",
    defaultModel: row.defaultModel ?? DEFAULT_MODEL,
  };
}

async function upsert(patch: Partial<Settings>) {
  const current = await getAppSettings();
  const next = { ...current, ...patch };
  await db
    .insert(appSettings)
    .values({
      id: APP_ID,
      connectionMode: next.connectionMode,
      defaultModel: next.defaultModel,
    })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: {
        connectionMode: next.connectionMode,
        defaultModel: next.defaultModel,
        updatedAt: new Date(),
      },
    });
}

export async function setConnectionMode(mode: ConnectionMode) {
  await upsert({ connectionMode: mode });
}

export async function setDefaultModel(model: string) {
  await upsert({ defaultModel: model });
}
