import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * The user's IANA timezone (e.g. "America/New_York"), or "UTC" if unset/missing.
 * Used when building the agent prompt so the date renders in the user's local
 * time — the server runs in UTC. Takes a userId (no session coupling) so cron
 * and supervisor runs resolve it the same way.
 */
export async function getUserTimezone(userId: string): Promise<string> {
  const [row] = await db
    .select({ timezone: schema.user.timezone })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  return row?.timezone || "UTC";
}
