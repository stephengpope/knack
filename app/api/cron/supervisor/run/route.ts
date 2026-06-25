import { after } from "next/server";
import { runSupervisorCycle } from "@/lib/supervisor/run";

/**
 * Runs one supervisor cycle for a card. Called server-to-server by the cron
 * tick (behind $CRON_SECRET) — and directly for local testing. Takes just
 * `{ chatId }`; the cycle re-derives the user from the row and claims the card
 * atomically, so a double-dispatch resolves to a single real run. Returns 202
 * and runs the cycle in the background. The lease (lib/supervisor/constants.ts)
 * is sized to the cross-plan max, so a platform-killed cycle still gets reclaimed.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { chatId } = (await req.json()) as { chatId?: string };
  if (!chatId) return new Response("Missing chatId", { status: 400 });

  after(async () => {
    try {
      await runSupervisorCycle(chatId);
    } catch (e) {
      console.error(`supervise run ${chatId} errored:`, (e as Error).message);
    }
  });

  return new Response(null, { status: 202 });
}
