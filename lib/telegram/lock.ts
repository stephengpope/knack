import "server-only";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { chat } from "@/lib/db/schema";

// Per-chat interactive-turn lock, on chat.chatLeaseUntil. Survives serverless
// invocations (DB-backed) so two webhook deliveries can't run concurrent turns
// on the same chat. Sized well past any single turn; a crashed turn auto-frees
// when the lease passes.
const TURN_LEASE_MS = 15 * 60 * 1000;

/** Claim the turn lock for a chat. Returns true if claimed, false if busy. */
export async function claimChatTurn(chatId: string): Promise<boolean> {
  const now = new Date();
  const lease = new Date(now.getTime() + TURN_LEASE_MS);
  const rows = await db
    .update(chat)
    .set({ chatLeaseUntil: lease })
    .where(
      and(
        eq(chat.id, chatId),
        or(isNull(chat.chatLeaseUntil), lt(chat.chatLeaseUntil, now)),
      ),
    )
    .returning({ id: chat.id });
  return rows.length > 0;
}

export async function releaseChatTurn(chatId: string): Promise<void> {
  await db
    .update(chat)
    .set({ chatLeaseUntil: null })
    .where(eq(chat.id, chatId));
}
