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
import { putAttachment } from "@/lib/attachments/blob";
import { classifyKind, type AttachmentPart } from "@/lib/attachments/types";

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

  // Resolve an inbound attachment (document or photo), if any. Telegram's
  // getFile caps downloads at 20 MB; oversize files are declined gracefully.
  const media = resolveMedia(msg);
  if (media && media.size != null && media.size > 20 * 1024 * 1024) {
    await client.sendMessage(
      dm,
      "That file is over Telegram's 20 MB bot limit — I can't fetch it.",
    );
    return;
  }

  if (!text && !media && (msg.voice || msg.audio)) {
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

  // A media message carries its prompt (if any) in the caption.
  if (media && !text) text = msg.caption?.trim() ?? "";

  if (!text && !media) return; // unsupported message type — ignore

  // Slash commands switch sessions/projects without running a turn (text-only).
  if (!media && (await handleCommand(account, client, text))) return;

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
    // Text/caption first, then the attachment (materialized into the sandbox by
    // runAgentTurn). Download + store the media now that we have a chatId.
    const parts: UIMessage["parts"] = [];
    if (text) parts.push({ type: "text", text });
    if (media) {
      const buf = Buffer.from(await client.downloadFile(media.fileId));
      const ref = await putAttachment(
        chatId,
        media.filename,
        media.mediaType,
        buf,
      );
      const attachment: AttachmentPart = {
        type: "data-attachment",
        data: { ...ref, kind: classifyKind(media.mediaType, media.filename) },
      };
      parts.push(attachment);
    }
    const message: UIMessage = {
      id: `msg-${nanoid()}`,
      role: "user",
      parts,
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

type InboundMedia = {
  fileId: string;
  filename: string;
  mediaType: string;
  size?: number;
};

// Map a Telegram document/photo onto a normalized attachment descriptor. Photos
// arrive as an ascending-size array; the last element is the largest rendition.
function resolveMedia(msg: TgMessage): InboundMedia | null {
  if (msg.document) {
    return {
      fileId: msg.document.file_id,
      filename: msg.document.file_name ?? `file-${msg.message_id}`,
      mediaType: msg.document.mime_type ?? "application/octet-stream",
      size: msg.document.file_size,
    };
  }
  if (msg.photo?.length) {
    const largest = msg.photo[msg.photo.length - 1];
    return {
      fileId: largest.file_id,
      filename: `photo-${msg.message_id}.jpg`,
      mediaType: "image/jpeg",
      size: largest.file_size,
    };
  }
  return null;
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
