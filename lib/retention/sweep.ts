import "server-only";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { chat } from "@/lib/db/schema";
import { deleteChatBlobs } from "@/lib/attachments/blob";

const DAY_MS = 86_400_000;

/**
 * Global chat-retention sweep. Deletes every UNSTARRED chat whose last-used
 * timestamp (`updatedAt`) predates the retention window, along with its Blob
 * attachments. Runs once per day from the cron tick. Not user-scoped — it
 * operates system-wide (unlike `deleteChat`).
 *
 * For each eligible chat it best-effort deletes the Blob files (failures are
 * logged but don't abort the sweep), cascades the linked supervisor chat
 * (`source='supervisor' AND sourceRef=id`, mirroring `deleteChat`), then deletes
 * the chat row. DB FKs cascade `message`/`usage_event`; the sandbox box expires
 * on its own TTL.
 *
 * @returns the number of chats deleted.
 */
export async function sweepExpiredChats(
  now: Date,
  retentionDays: number,
): Promise<number> {
  if (retentionDays <= 0) return 0; // disabled — keep forever

  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);

  const expired = await db
    .select({ id: chat.id })
    .from(chat)
    .where(and(eq(chat.starred, false), lt(chat.updatedAt, cutoff)));

  let deleted = 0;
  for (const { id } of expired) {
    try {
      await deleteChatBlobs(id);
    } catch (e) {
      console.error(
        `retention sweep: blob cleanup failed for chat ${id}:`,
        (e as Error).message,
      );
    }
    // Cascade the card's supervisor chat (linked by sourceRef, not an FK).
    await db
      .delete(chat)
      .where(and(eq(chat.source, "supervisor"), eq(chat.sourceRef, id)));
    await db.delete(chat).where(eq(chat.id, id));
    deleted++;
  }

  console.log(
    `retention sweep: deleted ${deleted} chat(s) not used since ${cutoff.toISOString()} (window ${retentionDays}d)`,
  );
  return deleted;
}
