import "server-only";
import { and, eq } from "drizzle-orm";
import type { UIMessage } from "ai";
import { db } from "@/lib/db";
import { chat, type Project } from "@/lib/db/schema";
import { createChat, loadMessages } from "@/lib/chats";
import { supervisorInstructions } from "@/lib/supervisor/prompt";

/** The supervisor chat's messages for a card, or [] if it has none yet. */
export async function getSupervisorMessages(
  userId: string,
  workerChatId: string,
): Promise<UIMessage[]> {
  const [row] = await db
    .select({ id: chat.id })
    .from(chat)
    .where(
      and(
        eq(chat.userId, userId),
        eq(chat.source, "supervisor"),
        eq(chat.sourceRef, workerChatId),
      ),
    )
    .limit(1);
  if (!row) return [];
  return loadMessages(row.id);
}

/**
 * The supervisor's own chat for a card — a normal `chat` row tagged
 * `source='supervisor'`, `sourceRef=<worker chatId>`, hidden from the Chats
 * list. Created lazily on the first cycle with `SUPERVISOR.md` frozen as its
 * system prompt (the per-round contract is supplied in messages, not here).
 */
export async function getOrCreateSupervisorChat(
  userId: string,
  workerChatId: string,
  project: Project | null,
  pat: string | null,
): Promise<string> {
  const [existing] = await db
    .select({ id: chat.id })
    .from(chat)
    .where(
      and(
        eq(chat.userId, userId),
        eq(chat.source, "supervisor"),
        eq(chat.sourceRef, workerChatId),
      ),
    )
    .limit(1);
  if (existing) return existing.id;

  const instructions = await supervisorInstructions(project, pat);
  const row = await createChat(userId, {
    title: "Supervisor",
    projectId: project?.id ?? null,
    systemPrompt: instructions,
    source: "supervisor",
    sourceRef: workerChatId,
  });
  return row.id;
}
