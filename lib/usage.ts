import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { usageEvent } from "@/lib/db/schema";

export type TurnUsage = { inputTokens: number; outputTokens: number };

/** Record one AI call's token usage against a card. */
export async function logUsage(
  chatId: string,
  role: "worker" | "supervisor",
  model: string | null,
  usage: TurnUsage,
): Promise<void> {
  await db.insert(usageEvent).values({
    id: nanoid(),
    chatId,
    role,
    model,
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
  });
}

/**
 * Total tokens used during the CURRENT run (everything logged at or after
 * `since` = the card's runStartedAt). The budget guard reads this, so restarting
 * a card (which moves runStartedAt forward) gives it a fresh window.
 */
export async function runTokens(chatId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${usageEvent.inputTokens} + ${usageEvent.outputTokens}), 0)`,
    })
    .from(usageEvent)
    .where(and(eq(usageEvent.chatId, chatId), gte(usageEvent.createdAt, since)));
  return Number(row?.total ?? 0);
}
