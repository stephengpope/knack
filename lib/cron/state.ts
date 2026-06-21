import "server-only";
import { and, eq, inArray, lte } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { cronState, type CronState } from "@/lib/db/schema";
import { nextRunAfter, type CronJob } from "@/lib/cron/file";

// The cron_state cache: the schedules parsed from each project's cron.json,
// with precomputed next-run times. Reconciled to the file when it changes;
// otherwise read as-is so a 304 tick can still fire due jobs.

/** The ETag stored for a project's cron file (any row — they share one). */
export async function getStoredEtag(projectId: string): Promise<string | null> {
  const [row] = await db
    .select({ etag: cronState.etag })
    .from(cronState)
    .where(eq(cronState.projectId, projectId))
    .limit(1);
  return row?.etag ?? null;
}

/**
 * Upsert the project's jobs to match the freshly-parsed file, prune jobs that
 * were removed, and store the new ETag. `nextRunAt` is recomputed only when a
 * job's schedule changed (or it's new) so a content edit doesn't shift timing.
 */
export async function reconcileJobs(
  projectId: string,
  jobs: CronJob[],
  etag: string | undefined,
  now: Date,
): Promise<void> {
  const existing = await db
    .select()
    .from(cronState)
    .where(eq(cronState.projectId, projectId));
  const byName = new Map(existing.map((r) => [r.jobName, r]));
  const incoming = new Set(jobs.map((j) => j.name));

  for (const job of jobs) {
    const prev = byName.get(job.name);
    if (!prev) {
      await db.insert(cronState).values({
        id: nanoid(),
        projectId,
        jobName: job.name,
        schedule: job.schedule,
        prompt: job.prompt,
        model: job.model,
        enabled: job.enabled,
        etag: etag ?? null,
        nextRunAt: nextRunAfter(job.schedule, now),
      });
    } else {
      const scheduleChanged = prev.schedule !== job.schedule;
      await db
        .update(cronState)
        .set({
          schedule: job.schedule,
          prompt: job.prompt,
          model: job.model,
          enabled: job.enabled,
          etag: etag ?? prev.etag,
          nextRunAt: scheduleChanged
            ? nextRunAfter(job.schedule, now)
            : prev.nextRunAt,
          updatedAt: new Date(),
        })
        .where(eq(cronState.id, prev.id));
    }
  }

  for (const row of existing) {
    if (!incoming.has(row.jobName)) {
      await db.delete(cronState).where(eq(cronState.id, row.id));
    }
  }
}

/** Drop all cached jobs for a project (cron.json absent / 404). */
export async function clearJobs(projectId: string): Promise<void> {
  await db.delete(cronState).where(eq(cronState.projectId, projectId));
}

/** Enabled jobs for a project whose next run is due (<= now). */
export async function dueJobs(
  projectId: string,
  now: Date,
): Promise<CronState[]> {
  return db
    .select()
    .from(cronState)
    .where(
      and(
        eq(cronState.projectId, projectId),
        eq(cronState.enabled, true),
        lte(cronState.nextRunAt, now),
      ),
    );
}

/** All cached job rows for a set of projects, keyed `projectId:jobName`. Used by
 *  the read-only /cron view to show each job's precomputed next-run time. */
export async function cronStateForProjects(
  projectIds: string[],
): Promise<Map<string, CronState>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(cronState)
    .where(inArray(cronState.projectId, projectIds));
  const map = new Map<string, CronState>();
  for (const r of rows) map.set(`${r.projectId}:${r.jobName}`, r);
  return map;
}

/** One job row (the worker reads prompt/model from here). */
export async function getJob(
  projectId: string,
  jobName: string,
): Promise<CronState | null> {
  const [row] = await db
    .select()
    .from(cronState)
    .where(
      and(eq(cronState.projectId, projectId), eq(cronState.jobName, jobName)),
    )
    .limit(1);
  return row ?? null;
}

/** Record a fire: stamp lastRunAt and advance nextRunAt past `now`. */
export async function markFired(
  projectId: string,
  jobName: string,
  now: Date,
): Promise<void> {
  const job = await getJob(projectId, jobName);
  if (!job) return;
  await db
    .update(cronState)
    .set({
      lastRunAt: now,
      nextRunAt: nextRunAfter(job.schedule, now),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(eq(cronState.id, job.id));
}
