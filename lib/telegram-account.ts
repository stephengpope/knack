import "server-only";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { telegramAccount, type TelegramAccount } from "@/lib/db/schema";
import { encrypt, decrypt } from "@/lib/crypto";

// Masked view for the UI — never includes the token or secret.
export type TelegramAccountSummary = {
  botUsername: string | null;
  authorizedTgUserId: number;
  active: boolean;
  activeChatId: string | null;
};

export async function getTelegramAccount(
  userId: string,
): Promise<TelegramAccountSummary | null> {
  const row = await accountRow(userId);
  return row
    ? {
        botUsername: row.botUsername,
        authorizedTgUserId: row.authorizedTgUserId,
        active: row.active,
        activeChatId: row.activeChatId,
      }
    : null;
}

export async function accountRow(
  userId: string,
): Promise<TelegramAccount | null> {
  const [row] = await db
    .select()
    .from(telegramAccount)
    .where(eq(telegramAccount.userId, userId))
    .limit(1);
  return row ?? null;
}

/** The full row keyed by the path param `userId` — the webhook entry point. */
export async function accountForWebhook(
  userId: string,
): Promise<TelegramAccount | null> {
  const row = await accountRow(userId);
  return row && row.active ? row : null;
}

export function decryptBotToken(row: TelegramAccount): string {
  return decrypt(row.encryptedBotToken);
}

export function decryptWebhookSecret(row: TelegramAccount): string {
  return decrypt(row.webhookSecret);
}

/** Upsert the single per-user row. Caller has already validated via getMe. */
export async function saveTelegramAccount(
  userId: string,
  input: {
    botToken: string;
    webhookSecret: string;
    botUsername: string | null;
    authorizedTgUserId: number;
  },
): Promise<void> {
  const existing = await accountRow(userId);
  const values = {
    encryptedBotToken: encrypt(input.botToken),
    webhookSecret: encrypt(input.webhookSecret),
    botUsername: input.botUsername,
    authorizedTgUserId: input.authorizedTgUserId,
    // In a private chat the DM chat id equals the user's numeric id.
    dmChatId: input.authorizedTgUserId,
    active: true as const,
    updatedAt: new Date(),
  };
  if (existing) {
    await db
      .update(telegramAccount)
      .set(values)
      .where(eq(telegramAccount.userId, userId));
  } else {
    await db
      .insert(telegramAccount)
      .values({ id: nanoid(), userId, ...values });
  }
}

export async function disconnectTelegram(userId: string): Promise<void> {
  await db.delete(telegramAccount).where(eq(telegramAccount.userId, userId));
}

/** Point this Telegram conversation at a (possibly new) knack chat. */
export async function setActiveChat(
  userId: string,
  chatId: string | null,
): Promise<void> {
  await db
    .update(telegramAccount)
    .set({ activeChatId: chatId, updatedAt: new Date() })
    .where(eq(telegramAccount.userId, userId));
}

/**
 * Webhook dedup. Telegram delivers at-least-once: a slow ack makes it resend the
 * same (monotonically increasing) update_id. CAS the high-water mark — returns
 * true if this update is new (claimed), false if it's a duplicate/old (skip).
 */
export async function markUpdateSeen(
  userId: string,
  updateId: number,
): Promise<boolean> {
  const rows = await db
    .update(telegramAccount)
    .set({ lastUpdateId: updateId })
    .where(
      and(
        eq(telegramAccount.userId, userId),
        or(
          isNull(telegramAccount.lastUpdateId),
          lt(telegramAccount.lastUpdateId, updateId),
        ),
      ),
    )
    .returning({ id: telegramAccount.id });
  return rows.length > 0;
}
