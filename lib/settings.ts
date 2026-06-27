import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";
import { DEFAULT_MODEL } from "@/lib/models";
import { encrypt, decrypt } from "@/lib/crypto";

export type ConnectionMode = "gateway" | "custom" | "compatible";

// Agent reasoning/thinking depth. "off" = no reasoning; the rest map to each
// provider's effort knob (see lib/reasoning.ts). Gated to reasoning-capable
// models, so it's a no-op on models that don't support it.
export type ReasoningEffort = "off" | "low" | "medium" | "high" | "max";

export type Settings = {
  connectionMode: ConnectionMode;
  defaultModel: string;
  // null = "Same as AI Agent" (fall back to defaultModel for background calls).
  generalModel: string | null;
  // Supervisor budget ceilings per card RUN (cards may override).
  maxRounds: number;
  maxTokensPerCard: number;
  // Output token cap for the AI Agent, always applied (see schema note).
  maxOutputTokens: number;
  // Agent reasoning depth (gated to reasoning-capable models).
  agentReasoning: ReasoningEffort;
  // Chat retention window (days). 0 = disabled (keep forever).
  retentionDays: number;
  // Self-improvement skill review: master switch + step-count threshold per chat.
  skillReviewEnabled: boolean;
  skillReviewInterval: number;
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
  maxOutputTokens: 16384,
  agentReasoning: "medium",
  retentionDays: 7,
  skillReviewEnabled: true,
  skillReviewInterval: 10,
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
    maxOutputTokens: row.maxOutputTokens ?? FALLBACK.maxOutputTokens,
    agentReasoning:
      (row.agentReasoning as ReasoningEffort) ?? FALLBACK.agentReasoning,
    retentionDays: row.retentionDays ?? 7,
    skillReviewEnabled: row.skillReviewEnabled ?? FALLBACK.skillReviewEnabled,
    skillReviewInterval: row.skillReviewInterval ?? FALLBACK.skillReviewInterval,
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
      maxOutputTokens: next.maxOutputTokens,
      agentReasoning: next.agentReasoning,
      retentionDays: next.retentionDays,
      skillReviewEnabled: next.skillReviewEnabled,
      skillReviewInterval: next.skillReviewInterval,
    })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: {
        connectionMode: next.connectionMode,
        defaultModel: next.defaultModel,
        generalModel: next.generalModel,
        maxOutputTokens: next.maxOutputTokens,
        agentReasoning: next.agentReasoning,
        retentionDays: next.retentionDays,
        skillReviewEnabled: next.skillReviewEnabled,
        skillReviewInterval: next.skillReviewInterval,
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

/** Chat retention window in days (0 = disabled — keep chats forever). */
export async function setRetentionDays(days: number) {
  await upsert({ retentionDays: days });
}

/** Output token cap for the AI Agent (always applied). */
export async function setMaxOutputTokens(tokens: number) {
  await upsert({ maxOutputTokens: tokens });
}

/** Agent reasoning depth (gated to reasoning-capable models). */
export async function setAgentReasoning(effort: ReasoningEffort) {
  await upsert({ agentReasoning: effort });
}

/** Self-improvement skill review config: master switch + step-count threshold. */
export async function setSkillReviewConfig(opts: {
  enabled: boolean;
  interval: number;
}) {
  await upsert({
    skillReviewEnabled: opts.enabled,
    skillReviewInterval: opts.interval,
  });
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

// ── SMTP / email ─────────────────────────────────────────────────────────────

/** Full, decrypted SMTP config — server-only, used to actually send mail. */
export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  pass: string; // decrypted; "" when no auth
  from: string;
};

/** Admin-display view: no secret, just whether a password is set + its last4. */
export type SmtpSettings = {
  enabled: boolean;
  host: string | null;
  port: number | null;
  secure: boolean;
  user: string | null;
  from: string | null;
  passLast4: string | null;
};

const DEFAULT_SMTP_PORT = 587;

/** Admin-facing SMTP settings for the Administration screen (no secret). */
export async function getSmtpSettings(): Promise<SmtpSettings> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, APP_ID))
    .limit(1);
  return {
    enabled: row?.smtpEnabled ?? false,
    host: row?.smtpHost ?? null,
    port: row?.smtpPort ?? null,
    secure: row?.smtpSecure ?? false,
    user: row?.smtpUser ?? null,
    from: row?.smtpFrom ?? null,
    passLast4: row?.smtpPassLast4 ?? null,
  };
}

/**
 * Decrypted send-ready config, or null when email is off/incomplete. Null is the
 * single source of truth for "email disabled" — `emailConfigured()`/`sendEmail()`
 * key off it.
 */
export async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, APP_ID))
    .limit(1);
  if (!row?.smtpEnabled || !row.smtpHost || !row.smtpFrom) return null;
  let pass = "";
  if (row.smtpPass) {
    try {
      pass = decrypt(row.smtpPass);
    } catch {
      return null; // password predates an ENCRYPTION_KEY rotation — treat as off
    }
  }
  return {
    host: row.smtpHost,
    port: row.smtpPort ?? DEFAULT_SMTP_PORT,
    secure: row.smtpSecure,
    user: row.smtpUser ?? null,
    pass,
    from: row.smtpFrom,
  };
}

export type SmtpInput = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string | null;
  // undefined/empty = keep the stored password (so the admin needn't retype it)
  pass?: string | null;
  from: string;
};

/** Upsert SMTP config. Encrypts the password; a blank password keeps the old one. */
export async function setSmtpConfig(input: SmtpInput) {
  const hasNewPass = Boolean(input.pass && input.pass.trim());
  const encPass = hasNewPass ? encrypt(input.pass!.trim()) : undefined;
  const last4 = hasNewPass ? input.pass!.trim().slice(-4) : undefined;

  const fields = {
    smtpEnabled: input.enabled,
    smtpHost: input.host.trim() || null,
    smtpPort: input.port,
    smtpSecure: input.secure,
    smtpUser: input.user?.trim() || null,
    smtpFrom: input.from.trim() || null,
    // only overwrite the secret when a new one was supplied
    ...(encPass ? { smtpPass: encPass, smtpPassLast4: last4 } : {}),
    updatedAt: new Date(),
  };

  await db
    .insert(appSettings)
    .values({ id: APP_ID, ...fields })
    .onConflictDoUpdate({ target: appSettings.id, set: fields });
}

/**
 * Decrypted stored SMTP password (or "" if none) — server-only. Lets the admin
 * "Test" without re-typing the saved password.
 */
export async function getStoredSmtpPass(): Promise<string> {
  const [row] = await db
    .select({ enc: appSettings.smtpPass })
    .from(appSettings)
    .where(eq(appSettings.id, APP_ID))
    .limit(1);
  if (!row?.enc) return "";
  try {
    return decrypt(row.enc);
  } catch {
    return "";
  }
}

/** Clear all SMTP config and turn email off. */
export async function deleteSmtpConfig() {
  await db
    .update(appSettings)
    .set({
      smtpEnabled: false,
      smtpHost: null,
      smtpPort: null,
      smtpSecure: false,
      smtpUser: null,
      smtpPass: null,
      smtpPassLast4: null,
      smtpFrom: null,
      updatedAt: new Date(),
    })
    .where(eq(appSettings.id, APP_ID));
}
