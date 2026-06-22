import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { DEFAULT_MODEL } from "@/lib/models";

export type ConnectionMode = "gateway" | "custom" | "compatible";

export type Settings = {
  connectionMode: ConnectionMode;
  defaultModel: string;
  // null = "Same as AI Agent" (fall back to defaultModel for background calls).
  generalModel: string | null;
  // Supervisor budget ceilings per card RUN (cards may override).
  maxRounds: number;
  maxTokensPerCard: number;
};

// Singleton row id — the deployment shares one config.
const APP_ID = "app";

const FALLBACK: Settings = {
  connectionMode: "gateway",
  defaultModel: DEFAULT_MODEL,
  generalModel: null,
  maxRounds: 25,
  maxTokensPerCard: 2_000_000,
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
    generalModel: row.generalModel ?? null,
    maxRounds: row.maxRounds ?? FALLBACK.maxRounds,
    maxTokensPerCard: row.maxTokensPerCard ?? FALLBACK.maxTokensPerCard,
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
      generalModel: next.generalModel,
    })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: {
        connectionMode: next.connectionMode,
        defaultModel: next.defaultModel,
        generalModel: next.generalModel,
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

/** Set the General AI model, or null for "Same as AI Agent". */
export async function setGeneralModel(model: string | null) {
  await upsert({ generalModel: model && model.trim() ? model : null });
}
