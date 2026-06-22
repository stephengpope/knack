import "server-only";
import { and, asc, desc, eq, isNull, ne, not, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { UIMessage } from "ai";
import { db } from "@/lib/db";
import { chat, message } from "@/lib/db/schema";

export type GitState = "clean" | "dirty";

export type ChatListItem = {
  id: string;
  title: string | null;
  starred: boolean;
  updatedAt: Date;
  gitState: string | null;
  lastCommitSha: string | null;
  source: string;
};

export async function listChats(userId: string): Promise<ChatListItem[]> {
  return db
    .select({
      id: chat.id,
      title: chat.title,
      starred: chat.starred,
      updatedAt: chat.updatedAt,
      gitState: chat.gitState,
      lastCommitSha: chat.lastCommitSha,
      source: chat.source,
    })
    .from(chat)
    // Cards live on the Board, not in the Chats list (open them via the
    // drawer's "Open chat"). A card is any chat with a non-null kanbanStatus.
    // Supervisor chats (source='supervisor') are internal — only reachable from
    // their card — so they're excluded too.
    .where(
      and(
        eq(chat.userId, userId),
        isNull(chat.kanbanStatus),
        ne(chat.source, "supervisor"),
      ),
    )
    .orderBy(desc(chat.updatedAt));
}

/** Persist gitSync's outcome on the chat row. No revalidatePath — the git
 *  indicators update via the client store, never by re-running the layout. */
export async function setChatGitState(
  userId: string,
  id: string,
  result: { state: GitState; sha?: string | null },
) {
  await db
    .update(chat)
    .set({
      gitState: result.state,
      lastCommitSha: result.sha ?? null,
      lastSyncedAt: new Date(),
    })
    .where(and(eq(chat.id, id), eq(chat.userId, userId)));
}

/** Read just the git fields for one chat (for the post-turn live re-read).
 *  `syncedAt` lets the client tell a fresh post-turn write from a stale one. */
export async function getChatGitStatus(
  userId: string,
  id: string,
): Promise<{ state: string | null; sha: string | null; syncedAt: Date | null }> {
  const [row] = await db
    .select({
      state: chat.gitState,
      sha: chat.lastCommitSha,
      syncedAt: chat.lastSyncedAt,
    })
    .from(chat)
    .where(and(eq(chat.id, id), eq(chat.userId, userId)))
    .limit(1);
  return row ?? { state: null, sha: null, syncedAt: null };
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
  opts: {
    id?: string;
    title?: string | null;
    model?: string | null;
    projectId?: string | null;
    systemPrompt?: string | null;
    source?: string;
    sourceRef?: string | null;
  } = {},
) {
  const [row] = await db
    .insert(chat)
    .values({
      id: opts.id ?? nanoid(),
      userId,
      title: opts.title ?? null,
      model: opts.model ?? null,
      projectId: opts.projectId ?? null,
      systemPrompt: opts.systemPrompt ?? null,
      source: opts.source ?? "user",
      sourceRef: opts.sourceRef ?? null,
    })
    .returning();
  return row;
}

/**
 * Most recent cron run per schedule, for the cron view. Maps `sourceRef`
 * (`projectId:jobName`) → the latest cron chat's id and creation time (= when
 * that run fired). One query across all the user's cron chats.
 */
export async function latestCronRuns(
  userId: string,
): Promise<Map<string, { chatId: string; at: Date }>> {
  const rows = await db
    .select({
      id: chat.id,
      sourceRef: chat.sourceRef,
      createdAt: chat.createdAt,
    })
    .from(chat)
    .where(and(eq(chat.userId, userId), eq(chat.source, "cron")))
    .orderBy(desc(chat.createdAt));
  const map = new Map<string, { chatId: string; at: Date }>();
  for (const r of rows) {
    if (r.sourceRef && !map.has(r.sourceRef)) {
      map.set(r.sourceRef, { chatId: r.id, at: r.createdAt });
    }
  }
  return map;
}

export async function renameChat(userId: string, id: string, title: string) {
  await db
    .update(chat)
    .set({ title, updatedAt: new Date() })
    .where(and(eq(chat.id, id), eq(chat.userId, userId)));
}

/**
 * Freeze a chat's system prompt at activation. Cards are created as draft rows
 * with a null systemPrompt; their first worker turn builds the prompt and
 * persists it here (so it incorporates whatever the repo holds at activation).
 * Internal (no userId scope) — called from the agent turn.
 */
export async function setChatSystemPrompt(id: string, systemPrompt: string) {
  await db.update(chat).set({ systemPrompt }).where(eq(chat.id, id));
}

export async function toggleStar(userId: string, id: string) {
  await db
    .update(chat)
    .set({ starred: not(chat.starred) })
    .where(and(eq(chat.id, id), eq(chat.userId, userId)));
}

export async function deleteChat(userId: string, id: string) {
  // Cascade the card's supervisor chat (linked by sourceRef, which isn't an FK).
  await db
    .delete(chat)
    .where(
      and(
        eq(chat.userId, userId),
        eq(chat.source, "supervisor"),
        eq(chat.sourceRef, id),
      ),
    );
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
