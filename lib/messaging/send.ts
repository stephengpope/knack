import "server-only";
import {
  accountRow,
  decryptBotToken,
} from "@/lib/telegram-account";
import { TelegramClient, splitMessage } from "@/lib/telegram/api";

// Outbound messaging dispatcher. The agent's send_message tool calls this to
// reach the user on their connected platform. `platform` defaults to the user's
// single connected account (today only Telegram); the param exists so the tool
// signature is stable once more platforms land.
export type Platform = "telegram";

export type SendResult =
  | { ok: true; platform: Platform }
  | { ok: false; error: string };

export async function sendUserMessage(
  userId: string,
  text: string,
  platform?: Platform,
): Promise<SendResult> {
  const trimmed = text?.trim();
  if (!trimmed) return { ok: false, error: "Message text is empty." };
  if (platform && platform !== "telegram") {
    return { ok: false, error: `Unsupported platform: ${platform}.` };
  }

  const account = await accountRow(userId);
  if (!account || !account.active) {
    return { ok: false, error: "No messaging app is connected for this user." };
  }
  const dm = account.dmChatId ?? account.authorizedTgUserId;
  const client = new TelegramClient(decryptBotToken(account));
  try {
    for (const chunk of splitMessage(trimmed)) {
      await client.sendMessage(dm, chunk);
    }
    return { ok: true, platform: "telegram" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
