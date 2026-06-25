import { after } from "next/server";
import crypto from "node:crypto";
import { nanoid } from "nanoid";
import type { UIMessage } from "ai";
import {
  accountForWebhook,
  accountRow,
  decryptBotToken,
  decryptWebhookSecret,
  markUpdateSeen,
  setActiveChat,
} from "@/lib/telegram-account";
import { runAgentTurn } from "@/lib/agent/run-turn";
import { TelegramClient, type TgMessage, type TgUpdate } from "@/lib/telegram/api";
import { handleCommand } from "@/lib/telegram/commands";
import { streamTurnToTelegram } from "@/lib/telegram/stream";
import { claimChatTurn, releaseChatTurn } from "@/lib/telegram/lock";
import { transcribeAudio } from "@/lib/voice/transcribe";
import { getDefaultProject } from "@/lib/projects";
import { createChat } from "@/lib/chats";

// Public webhook (under /api, so middleware's auth doesn't apply). Gated instead
// by Telegram's secret token + the authorized user id. Returns 200 immediately
// and runs the turn in after() — Telegram needs a fast ack or it retries.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const { userId } = await params;
  const account = await accountForWebhook(userId);
  // Unknown/disabled account: 200 so we don't reveal which ids exist.
  if (!account) return ok();

  // Verify Telegram's secret-token header (constant time).
  const header = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!timingSafeEqualStr(header, decryptWebhookSecret(account))) {
    return new Response("forbidden", { status: 403 });
  }

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return ok();
  }

  const msg = update.message;
  if (!msg) return ok();
  // Only the one authorized human may drive the bot.
  if (msg.from?.id !== account.authorizedTgUserId) return ok();
  // Dedup at-least-once redeliveries.
  if (!(await markUpdateSeen(userId, update.update_id))) return ok();

  const client = new TelegramClient(decryptBotToken(account));
  const dm = account.dmChatId ?? account.authorizedTgUserId;

  after(async () => {
    try {
      await processMessage(userId, client, dm, msg);
    } catch (e) {
      await client
        .sendMessage(dm, `⚠️ ${(e as Error).message}`)
        .catch(() => {});
    }
  });
  return ok();
}

async function processMessage(
  userId: string,
  client: TelegramClient,
  dm: number,
  msg: TgMessage,
) {
  // Re-read for the freshest activeChatId (a command may have just moved it).
  const account = await accountRow(userId);
  if (!account) return;

  // Resolve the prompt text — transcribing voice/audio when present.
  let text = msg.text?.trim() ?? "";
  if (!text && (msg.voice || msg.audio)) {
    const fileId = (msg.voice ?? msg.audio)!.file_id;
    const audio = await client.downloadFile(fileId);
    const transcript = await transcribeAudio(audio);
    if (transcript == null) {
      await client.sendMessage(dm, "🎤 Voice transcription isn't configured.");
      return;
    }
    if (!transcript) {
      await client.sendMessage(dm, "🎤 I couldn't make out any speech.");
      return;
    }
    text = transcript;
  }
  if (!text) return; // unsupported message type — ignore

  // Slash commands switch sessions/projects without running a turn.
  if (await handleCommand(account, client, text)) return;

  // Ensure there's an active session; create one on the default project if not.
  let chatId = account.activeChatId;
  if (!chatId) {
    const project = await getDefaultProject(userId);
    if (!project) {
      await client.sendMessage(
        dm,
        "No project is set up yet. Create one in the web app first.",
      );
      return;
    }
    chatId = `chat-${nanoid()}`;
    await createChat(userId, {
      id: chatId,
      projectId: project.id,
      source: "telegram",
      sourceRef: String(dm),
    });
    await setActiveChat(userId, chatId);
  }

  // One turn at a time per chat. Busy → reply under the offending message, drop.
  if (!(await claimChatTurn(chatId))) {
    await client.sendMessage(dm, "Busy with your last request ⌛", {
      replyToMessageId: msg.message_id,
    });
    return;
  }

  try {
    const message: UIMessage = {
      id: `msg-${nanoid()}`,
      role: "user",
      parts: [{ type: "text", text }],
    };
    const result = await runAgentTurn({
      userId,
      chatId,
      message,
      chat: { source: "telegram", sourceRef: String(dm) },
    });
    await streamTurnToTelegram(
      client,
      dm,
      result.stream as ReadableStream<unknown>,
    );
    if (result.sync) await result.sync();
  } finally {
    await releaseChatTurn(chatId);
  }
}

function ok() {
  return new Response("ok", { status: 200 });
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
