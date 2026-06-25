import "server-only";
import { TelegramClient, splitMessage } from "@/lib/telegram/api";

// Consume a runAgentTurn UI-message stream and render it to Telegram. This is the
// Telegram analogue of drainStream: it MUST read the stream to completion so the
// stream's onFinish (message persistence) runs. Instead of discarding chunks, it
// turns them into chat output.
//
// Ordering matters: Telegram messages are append-only. So we stream each TEXT
// SEGMENT (the text between tool calls) as its own message, editing it in place
// on a ~1.3s cadence, and drop a one-line marker for each tool call between
// segments. The final answer therefore lands after the tools that produced it.

const EDIT_INTERVAL_MS = 1300; // ~1 edit/sec ceiling + headroom (Telegram 429s faster)
const TYPING_INTERVAL_MS = 4000; // typing bubble expires ~5s; refresh under that

const TOOL_EMOJI: Record<string, string> = {
  bash_run: "⚙️",
  file_read: "📄",
  file_write: "📝",
  file_edit: "✏️",
  files_list: "📁",
  search_files: "🔎",
  skill_load: "📚",
  skill_manage: "📚",
  skills_list: "📚",
  secrets_list: "🔑",
  secret_get: "🔑",
  send_message: "📤",
};

type Chunk = { type: string } & Record<string, unknown>;

export async function streamTurnToTelegram(
  client: TelegramClient,
  chatId: number,
  stream: ReadableStream<unknown>,
): Promise<void> {
  const typing = setInterval(
    () => void client.sendChatAction(chatId).catch(() => {}),
    TYPING_INTERVAL_MS,
  );
  void client.sendChatAction(chatId).catch(() => {});

  // Current streaming segment state.
  let msgId: number | null = null;
  let text = "";
  let lastEdit = 0;
  let dirty = false;

  const flushEdit = async (force: boolean) => {
    if (!dirty || !text) return;
    const now = Date.now();
    if (!force && now - lastEdit < EDIT_INTERVAL_MS) return;
    lastEdit = now;
    dirty = false;
    if (text.length > 4096) return; // oversized: leave for the final split
    try {
      if (msgId == null) {
        const m = await client.sendMessage(chatId, text);
        msgId = m.message_id;
      } else {
        await client.editMessageText(chatId, msgId, text);
      }
    } catch {
      // a dropped edit is non-fatal; the next tick or the final flush recovers
    }
  };

  // Finalize the current segment: write the full text, splitting if >4096.
  const endSegment = async () => {
    if (!text) {
      msgId = null;
      return;
    }
    const chunks = splitMessage(text);
    try {
      if (msgId == null) {
        const m = await client.sendMessage(chatId, chunks[0]);
        msgId = m.message_id;
      } else {
        await client.editMessageText(chatId, msgId, chunks[0]);
      }
      for (const extra of chunks.slice(1)) {
        await client.sendMessage(chatId, extra);
      }
    } catch {
      // best-effort; the message history in the DB remains the source of truth
    }
    msgId = null;
    text = "";
    dirty = false;
  };

  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value as Chunk;
      switch (chunk.type) {
        case "text-delta": {
          text += (chunk.delta as string) ?? "";
          dirty = true;
          await flushEdit(false);
          break;
        }
        case "tool-input-available": {
          // Segment break: close out any in-flight text, then mark the tool.
          await endSegment();
          await sendToolLine(client, chatId, chunk);
          void client.sendChatAction(chatId).catch(() => {});
          break;
        }
        case "error": {
          await endSegment();
          const msg = (chunk.errorText as string) || "Something went wrong.";
          await client.sendMessage(chatId, `⚠️ ${msg}`).catch(() => {});
          break;
        }
        default:
          break; // text-start/end, step boundaries, data parts, etc. — ignored
      }
    }
    await endSegment();
  } finally {
    clearInterval(typing);
    reader.releaseLock();
  }
}

async function sendToolLine(client: TelegramClient, chatId: number, chunk: Chunk) {
  const name = (chunk.toolName as string) ?? "tool";
  const emoji = TOOL_EMOJI[name] ?? "🔧";
  const preview = toolPreview(name, chunk.input);
  const line = preview ? `${emoji} ${name}: ${preview}` : `${emoji} ${name}`;
  await client.sendMessage(chatId, line).catch(() => {});
}

// A short, single-line preview of the most informative argument for known tools.
function toolPreview(name: string, input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const a = input as Record<string, unknown>;
  const pick =
    name === "bash_run"
      ? a.cmd
      : name === "search_files"
        ? a.query
        : a.path ?? a.name;
  if (typeof pick !== "string") return null;
  const one = pick.replace(/\s+/g, " ").trim();
  return one.length > 60 ? one.slice(0, 57) + "…" : one;
}
