import "server-only";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { chat } from "@/lib/db/schema";
import { LEASE_MS } from "@/lib/supervisor/constants";

// Per-chat interactive-turn lock, on chat.chatLeaseUntil. Survives serverless
// invocations (DB-backed) so two webhook deliveries can't run concurrent turns
// on the same chat. Reuses the supervisor's LEASE_MS — sized to the platform's
// max function runtime so the lease can never expire under a healthy turn; a
// crashed turn auto-frees when the lease passes.

/** Claim the turn lock for a chat. Returns true if claimed, false if busy. */
export async function claimChatTurn(chatId: string): Promise<boolean> {
  const now = new Date();
  const lease = new Date(now.getTime() + LEASE_MS);
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
