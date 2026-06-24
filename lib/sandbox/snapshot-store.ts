import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";

// Persistence for the sandbox tools-snapshot id. The id can't live in a Vercel
// env var (those are baked at deploy, unwritable at runtime), so it rides on the
// app_settings singleton. Pure DB — no @vercel/sandbox import here.

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
