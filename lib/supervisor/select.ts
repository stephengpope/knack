import "server-only";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { chat } from "@/lib/db/schema";
import { LEASE_MS } from "@/lib/supervisor/constants";

export type ClaimedCard = typeof chat.$inferSelect;

// Statuses the supervisor loop drives: `plan` (worker plans, read-only) and
// `in_progress` (worker executes). Same machinery; the cycle branches on which.
const ACTIVE_STATUSES = ["in_progress", "plan"] as const;

/**
 * Card ids eligible for a supervisor cycle right now: supervised, in an active
 * status (plan or in_progress), and not currently leased. The tick dispatches
 * these; the run worker then claims atomically (so a double-dispatch resolves to
 * one real run).
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
        eq(chat.supervisorEnabled, true),
        inArray(chat.kanbanStatus, ACTIVE_STATUSES as unknown as string[]),
        or(
          isNull(chat.supervisorLeaseUntil),
          lt(chat.supervisorLeaseUntil, now),
        ),
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
      supervisorLeaseUntil: lease,
      lastRunAt: now,
      runStartedAt: sql`coalesce(${chat.runStartedAt}, ${now})`,
    })
    .where(
      and(
        eq(chat.id, chatId),
        eq(chat.supervisorEnabled, true),
        inArray(chat.kanbanStatus, ACTIVE_STATUSES as unknown as string[]),
        or(
          isNull(chat.supervisorLeaseUntil),
          lt(chat.supervisorLeaseUntil, now),
        ),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function releaseLease(chatId: string): Promise<void> {
  await db
    .update(chat)
    .set({ supervisorLeaseUntil: null })
    .where(eq(chat.id, chatId));
}
