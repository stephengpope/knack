import "server-only";
import { and, asc, desc, eq, not, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { UIMessage } from "ai";
import { db } from "@/lib/db";
import { chat, message } from "@/lib/db/schema";

export type ChatListItem = {
  id: string;
  title: string | null;
  starred: boolean;
  updatedAt: Date;
};

export async function listChats(userId: string): Promise<ChatListItem[]> {
  return db
    .select({
      id: chat.id,
      title: chat.title,
      starred: chat.starred,
      updatedAt: chat.updatedAt,
    })
    .from(chat)
    .where(eq(chat.userId, userId))
    .orderBy(desc(chat.updatedAt));
}

export async function getChat(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(chat)
    .where(and(eq(chat.id, id), eq(chat.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function createChat(
  userId: string,
  opts: { id?: string; title?: string | null; model?: string | null } = {},
) {
  const [row] = await db
    .insert(chat)
    .values({
      id: opts.id ?? nanoid(),
      userId,
      title: opts.title ?? null,
      model: opts.model ?? null,
    })
    .returning();
  return row;
}

export async function renameChat(userId: string, id: string, title: string) {
  await db
    .update(chat)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(chat.id, id), eq(chat.userId, userId)));
}

export async function toggleStar(userId: string, id: string) {
  await db
    .update(chat)
    .set({ starred: not(chat.starred) })
    .where(and(eq(chat.id, id), eq(chat.userId, userId)));
}

export async function deleteChat(userId: string, id: string) {
  await db.delete(chat).where(and(eq(chat.id, id), eq(chat.userId, userId)));
}

/**
 * Load persisted messages for a chat as AI SDK UIMessages.
 * Ownership is the caller's responsibility (the chat page verifies it via
 * getChat); this avoids a duplicate ownership round-trip.
 */
export async function loadMessages(chatId: string): Promise<UIMessage[]> {
  const rows = await db
    .select()
    .from(message)
    .where(eq(message.chatId, chatId))
    .orderBy(asc(message.idx));
  return rows.map((r) => ({
    id: r.id,
    role: r.role as UIMessage["role"],
    parts: r.parts as UIMessage["parts"],
  }));
}

/**
 * Persist a chat turn (called in agent onFinish). The full UIMessage[] is the
 * source of truth (AI SDK canonical pattern): upsert every message by id so new
 * messages insert and any changed ones update.
 */
export async function saveMessages(chatId: string, messages: UIMessage[]) {
  if (messages.length) {
    await db
      .insert(message)
      .values(
        messages.map((m, i) => ({
          id: m.id,
          chatId,
          role: m.role,
          parts: m.parts as unknown as object,
          idx: i,
        })),
      )
      .onConflictDoUpdate({
        target: message.id,
        set: {
          parts: sql`excluded.parts`,
          idx: sql`excluded.idx`,
          role: sql`excluded.role`,
        },
      });
  }
  await db.update(chat).set({ updatedAt: new Date() }).where(eq(chat.id, chatId));
}
