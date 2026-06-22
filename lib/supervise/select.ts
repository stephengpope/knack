import "server-only";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { chat } from "@/lib/db/schema";
import { LEASE_MS } from "@/lib/supervise/constants";

export type ClaimedCard = typeof chat.$inferSelect;

/**
 * Card ids eligible for a supervisor cycle right now: supervised, in_progress,
 * and not currently leased. The tick dispatches these; the run worker then
 * claims atomically (so a double-dispatch resolves to one real run).
 */
export async function listEligibleCardIds(
  now: Date,
  limit: number,
): Promise<string[]> {
  if (limit <= 0) return [];
  const rows = await db
    .select({ id: chat.id })
    .from(chat)
    .where(
      and(
        eq(chat.superviseEnabled, true),
        eq(chat.kanbanStatus, "in_progress"),
        or(isNull(chat.leaseUntil), lt(chat.leaseUntil, now)),
      ),
    )
    .limit(limit);
  return rows.map((r) => r.id);
}

/**
 * Atomically claim a card for one cycle — take the lease only if it's free.
 * Returns the claimed row, or null if another runner beat us or it's no longer
 * eligible. Starts the run window (runStartedAt) if it wasn't already.
 */
export async function claimCard(chatId: string): Promise<ClaimedCard | null> {
  const now = new Date();
  const lease = new Date(now.getTime() + LEASE_MS);
  const rows = await db
    .update(chat)
    .set({
      leaseUntil: lease,
      lastRunAt: now,
      runStartedAt: sql`coalesce(${chat.runStartedAt}, ${now})`,
    })
    .where(
      and(
        eq(chat.id, chatId),
        eq(chat.superviseEnabled, true),
        eq(chat.kanbanStatus, "in_progress"),
        or(isNull(chat.leaseUntil), lt(chat.leaseUntil, now)),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function releaseLease(chatId: string): Promise<void> {
  await db.update(chat).set({ leaseUntil: null }).where(eq(chat.id, chatId));
}
