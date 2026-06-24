import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { DEFAULT_MODEL } from "@/lib/models";
import { encrypt, decrypt } from "@/lib/crypto";

export type ConnectionMode = "gateway" | "custom" | "compatible";

export type Settings = {
  connectionMode: ConnectionMode;
  defaultModel: string;
  // null = "Same as AI Agent" (fall back to defaultModel for background calls).
  generalModel: string | null;
  // Supervisor budget ceilings per card RUN (cards may override).
  maxRounds: number;
  maxTokensPerCard: number;
  // Voice dictation (AssemblyAI). No secret here — just whether it's set + last4.
  voiceConfigured: boolean;
  voiceLast4: string | null;
};

// Singleton row id — the deployment shares one config.
const APP_ID = "app";

const FALLBACK: Settings = {
  connectionMode: "gateway",
  defaultModel: DEFAULT_MODEL,
  generalModel: null,
  maxRounds: 25,
  maxTokensPerCard: 2_000_000,
  voiceConfigured: false,
  voiceLast4: null,
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
    voiceConfigured: Boolean(row.assemblyaiKey),
    voiceLast4: row.assemblyaiKeyLast4 ?? null,
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

/** Store the AssemblyAI streaming key (encrypted) + its last4 for display. */
export async function setVoiceKey(rawKey: string) {
  const value = rawKey.trim();
  const last4 = value.slice(-4);
  const encrypted = encrypt(value);
  await db
    .insert(appSettings)
    .values({
      id: APP_ID,
      assemblyaiKey: encrypted,
      assemblyaiKeyLast4: last4,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: {
        assemblyaiKey: encrypted,
        assemblyaiKeyLast4: last4,
        updatedAt: new Date(),
      },
    });
}

export async function deleteVoiceKey() {
  await db
    .update(appSettings)
    .set({ assemblyaiKey: null, assemblyaiKeyLast4: null, updatedAt: new Date() })
    .where(eq(appSettings.id, APP_ID));
}

/** Decrypted AssemblyAI key — server-only, used only to mint a temp token. */
export async function getAssemblyaiKey(): Promise<string | null> {
  const [row] = await db
    .select({ enc: appSettings.assemblyaiKey })
    .from(appSettings)
    .where(eq(appSettings.id, APP_ID))
    .limit(1);
  if (!row?.enc) return null;
  try {
    return decrypt(row.enc);
  } catch {
    return null; // key predates an ENCRYPTION_KEY rotation
  }
}
