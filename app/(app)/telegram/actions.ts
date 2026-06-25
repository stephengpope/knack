"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { TelegramClient } from "@/lib/telegram/api";
import { BOT_COMMANDS } from "@/lib/telegram/commands";
import {
  saveTelegramAccount,
  disconnectTelegram,
  accountRow,
  decryptBotToken,
} from "@/lib/telegram-account";

/**
 * Connect a Telegram bot: validate the token via getMe, register the webhook
 * (with a fresh secret) + the command menu, then store the encrypted row. The
 * authorized user id gates every inbound message to one person.
 */
export async function connectTelegramAction(token: string, tgUserId: string) {
  const user = await requireUser();
  const t = token.trim();
  const uid = Number.parseInt(tgUserId.trim(), 10);
  if (!t) throw new Error("Enter your bot token.");
  if (!Number.isInteger(uid) || uid <= 0) {
    throw new Error("Enter your numeric Telegram user ID (try @userinfobot).");
  }
  const base = process.env.BETTER_AUTH_URL;
  if (!base) {
    throw new Error("Server base URL (BETTER_AUTH_URL) is not configured.");
  }

  const client = new TelegramClient(t);
  let me;
  try {
    me = await client.getMe();
  } catch {
    throw new Error("Telegram rejected that bot token.");
  }

  const secret = crypto.randomBytes(32).toString("hex");
  const webhookUrl = `${base.replace(/\/$/, "")}/api/telegram/${user.id}/webhook`;
  await client.setWebhook(webhookUrl, secret);
  await client.setMyCommands(BOT_COMMANDS);

  await saveTelegramAccount(user.id, {
    botToken: t,
    webhookSecret: secret,
    botUsername: me.username ?? null,
    authorizedTgUserId: uid,
  });
  revalidatePath("/telegram");
  return { username: me.username ?? null };
}

export async function disconnectTelegramAction() {
  const user = await requireUser();
  const account = await accountRow(user.id);
  if (account) {
    // Best-effort: stop Telegram from delivering to a webhook we're removing.
    try {
      await new TelegramClient(decryptBotToken(account)).deleteWebhook();
    } catch {
      // ignore — the row is gone regardless
    }
  }
  await disconnectTelegram(user.id);
  revalidatePath("/telegram");
}
