import "server-only";

// Thin Telegram Bot API client. One instance per bot token. Messages are sent as
// PLAIN TEXT (no parse_mode): Telegram's MarkdownV2 requires escaping ~18 special
// characters or it 400s, and agent output is arbitrary markdown — plain text is
// the safe default for v1. Rate limits are respected by honoring 429 retry_after.

const API = "https://api.telegram.org";

export type TgUser = { id: number; is_bot: boolean; username?: string };
export type TgChat = { id: number; type: string };
export type TgMessage = {
  message_id: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  caption?: string;
  voice?: { file_id: string; duration: number; mime_type?: string };
  audio?: { file_id: string; mime_type?: string };
  photo?: Array<{
    file_id: string;
    file_size?: number;
    width?: number;
    height?: number;
  }>;
  document?: {
    file_id: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
  };
};
export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
};

export type BotCommand = { command: string; description: string };

class TelegramApiError extends Error {
  constructor(
    public method: string,
    public code: number,
    public description: string,
  ) {
    super(`telegram ${method} failed (${code}): ${description}`);
  }
}

export class TelegramClient {
  constructor(private token: string) {}

  /** One Bot API call, honoring a single 429 retry_after backoff (+0.2s). */
  private async call<T>(method: string, body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`${API}/bot${this.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = (await res.json()) as {
        ok: boolean;
        result?: T;
        error_code?: number;
        description?: string;
        parameters?: { retry_after?: number };
      };
      if (json.ok) return json.result as T;

      const retryAfter = json.parameters?.retry_after;
      if (retryAfter != null && attempt === 0) {
        await sleep(retryAfter * 1000 + 200); // wait the window + 0.2s headroom
        continue;
      }
      throw new TelegramApiError(
        method,
        json.error_code ?? res.status,
        json.description ?? "unknown error",
      );
    }
    // unreachable — the loop either returns or throws
    throw new TelegramApiError(method, 0, "exhausted retries");
  }

  getMe() {
    return this.call<TgUser>("getMe");
  }

  setWebhook(url: string, secretToken: string) {
    return this.call("setWebhook", {
      url,
      secret_token: secretToken,
      allowed_updates: ["message"],
      drop_pending_updates: true,
    });
  }

  deleteWebhook() {
    return this.call("deleteWebhook", { drop_pending_updates: false });
  }

  setMyCommands(commands: BotCommand[]) {
    return this.call("setMyCommands", { commands });
  }

  /** Returns the sent message (so the caller can keep its id for editing). */
  sendMessage(
    chatId: number,
    text: string,
    opts?: { replyToMessageId?: number },
  ) {
    return this.call<TgMessage>("sendMessage", {
      chat_id: chatId,
      text,
      ...(opts?.replyToMessageId
        ? { reply_parameters: { message_id: opts.replyToMessageId } }
        : {}),
    });
  }

  editMessageText(chatId: number, messageId: number, text: string) {
    return this.call<TgMessage | boolean>("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
    });
  }

  sendChatAction(chatId: number, action = "typing") {
    return this.call("sendChatAction", { chat_id: chatId, action });
  }

  private getFile(fileId: string) {
    return this.call<{ file_path: string }>("getFile", { file_id: fileId });
  }

  /** Download a file (e.g. a voice note) by file_id. <=20MB per Bot API. */
  async downloadFile(fileId: string): Promise<ArrayBuffer> {
    const { file_path } = await this.getFile(fileId);
    const res = await fetch(`${API}/file/bot${this.token}/${file_path}`);
    if (!res.ok) {
      throw new TelegramApiError("downloadFile", res.status, file_path);
    }
    return res.arrayBuffer();
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const TELEGRAM_MAX = 4096; // UTF-16 code units == JS string .length

/**
 * Split text into <=4096-unit chunks on natural boundaries (paragraph > line >
 * space), never mid-word. Open code fences are closed at a chunk end and
 * reopened (carrying the language tag) at the next, so each chunk renders. A
 * ` (i/n)` indicator is appended when there's more than one chunk.
 */
export function splitMessage(text: string, max = TELEGRAM_MAX): string[] {
  if (text.length <= max) return [text];

  const RESERVE = 12; // room for " (12/34)"
  const FENCE = "\n```";
  const chunks: string[] = [];
  let remaining = text;
  let carryLang: string | null = null;

  while (remaining.length) {
    const prefix = carryLang != null ? "```" + carryLang + "\n" : "";
    const headroom = max - RESERVE - prefix.length - FENCE.length;
    const limit = Math.min(headroom, remaining.length);

    let splitAt: number;
    if (remaining.length <= headroom) {
      splitAt = remaining.length;
    } else {
      const region = remaining.slice(0, limit);
      let at = region.lastIndexOf("\n");
      if (at < limit / 2) at = region.lastIndexOf(" ");
      splitAt = at < 1 ? limit : at;
    }

    const body = remaining.slice(0, splitAt);
    remaining = remaining.slice(splitAt).replace(/^\s+/, "");

    // Did this chunk end inside a fenced code block?
    let inCode = carryLang != null;
    let lang: string = carryLang ?? "";
    for (const line of body.split("\n")) {
      const s = line.trimStart();
      if (s.startsWith("```")) {
        if (inCode) {
          inCode = false;
          lang = "";
        } else {
          inCode = true;
          lang = s.slice(3).trim().split(/\s+/)[0] ?? "";
        }
      }
    }

    let chunk = prefix + body;
    if (inCode) {
      chunk += FENCE;
      carryLang = lang;
    } else {
      carryLang = null;
    }
    chunks.push(chunk);
  }

  if (chunks.length > 1) {
    const n = chunks.length;
    return chunks.map((c, i) => `${c} (${i + 1}/${n})`);
  }
  return chunks;
}
