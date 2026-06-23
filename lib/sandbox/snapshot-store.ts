import "server-only";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";

// Persistence for the sandbox snapshot id + build lock. The id can't live in a
// Vercel env var (those are baked at deploy, unwritable at runtime), so it rides
// on the app_settings singleton. Pure DB — no @vercel/sandbox import here.

const APP_ID = "app";
export type SnapshotStatus = "building" | "ready" | "failed";
export type SnapshotState = { id: string | null; status: SnapshotStatus | null };

/** Ensure the singleton row exists (defaults fill the other columns). */
async function ensureRow(): Promise<void> {
  await db
    .insert(appSettings)
    .values({ id: APP_ID })
    .onConflictDoNothing({ target: appSettings.id });
}

export async function getSnapshot(): Promise<SnapshotState> {
  const [row] = await db
    .select({
      id: appSettings.sandboxSnapshotId,
      status: appSettings.sandboxSnapshotStatus,
    })
    .from(appSettings)
    .where(eq(appSettings.id, APP_ID))
    .limit(1);
  return {
    id: row?.id ?? null,
    status: (row?.status as SnapshotStatus | null) ?? null,
  };
}

// A 'building' lock older than this is treated as a crashed builder (the request
// died before setReady/setFailed) and may be reclaimed. Must exceed a real
// build's wall time.
const STALE_BUILD_MS = 15 * 60 * 1000;

/**
 * Compare-and-set the build lock. Claims the slot (status → 'building') only
 * when it's unbuilt (NULL), previously 'failed', or a 'building' lock has gone
 * stale (crashed builder). Never steals a 'ready' snapshot or an in-progress
 * build. Returns true if THIS caller won the slot — concurrent first boxes:
 * exactly one wins, the rest fall back to a plain box.
 */
export async function acquireBuild(): Promise<boolean> {
  await ensureRow();
  const staleBefore = new Date(Date.now() - STALE_BUILD_MS);
  const won = await db
    .update(appSettings)
    .set({ sandboxSnapshotStatus: "building", updatedAt: new Date() })
    .where(
      and(
        eq(appSettings.id, APP_ID),
        or(
          isNull(appSettings.sandboxSnapshotStatus),
          eq(appSettings.sandboxSnapshotStatus, "failed"),
          and(
            eq(appSettings.sandboxSnapshotStatus, "building"),
            lt(appSettings.updatedAt, staleBefore),
          ),
        ),
      ),
    )
    .returning({ id: appSettings.id });
  return won.length > 0;
}

export async function setReady(id: string): Promise<void> {
  await ensureRow();
  await db
    .update(appSettings)
    .set({
      sandboxSnapshotId: id,
      sandboxSnapshotStatus: "ready",
      updatedAt: new Date(),
    })
    .where(eq(appSettings.id, APP_ID));
}

export async function setFailed(): Promise<void> {
  await db
    .update(appSettings)
    .set({ sandboxSnapshotStatus: "failed", updatedAt: new Date() })
    .where(eq(appSettings.id, APP_ID));
}

/** Self-heal: forget a snapshot that the API reports as gone (404 not_found). */
export async function clearSnapshot(): Promise<void> {
  await db
    .update(appSettings)
    .set({
      sandboxSnapshotId: null,
      sandboxSnapshotStatus: null,
      updatedAt: new Date(),
    })
    .where(eq(appSettings.id, APP_ID));
}
