import { getGithubAuth } from "@/lib/github-account";
import { listActiveProjects } from "@/lib/projects";
import { getFileContentsConditional } from "@/lib/github";
import { CRON_FILE, parseCronFile } from "@/lib/cron/file";
import {
  getStoredEtag,
  reconcileJobs,
  clearJobs,
  dueJobs,
  markFired,
} from "@/lib/cron/state";
import { listEligibleCardIds } from "@/lib/supervise/select";
import type { CronState, Project } from "@/lib/db/schema";

export const maxDuration = 300;

// Hobby allows 10 concurrent sandboxes; each dispatched run is one. Cap the
// runs started per tick to stay under it — anything left stays due and fires on
// the next tick (catch-up). Operators on higher tiers can raise this.
const MAX_RUNS_PER_TICK = 8;

/**
 * The single cron heartbeat (configured in vercel.json). Vercel invokes it via
 * GET with `Authorization: Bearer $CRON_SECRET`. It polls every active project's
 * `cron.json` (ETag-conditional — unchanged files cost no rate limit), keeps the
 * cron_state cache in sync, and dispatches due jobs to the run worker.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = new Date();
  const origin = new URL(req.url).origin;
  const projects = await listActiveProjects();

  // Phase 1: refresh each project's cache and collect due jobs.
  const due: { project: Project; job: CronState }[] = [];
  for (const project of projects) {
    try {
      const gh = await getGithubAuth(project.userId);
      if (!gh) continue; // owner has no connected GitHub account — skip
      const etag = await getStoredEtag(project.id);
      const res = await getFileContentsConditional(
        gh.pat,
        project.repoOwner,
        project.repoName,
        CRON_FILE,
        project.defaultBranch,
        etag,
      );
      if (res.status === 404) {
        await clearJobs(project.id);
        continue;
      }
      if (res.status === 200) {
        // parseCronFile throws on a malformed file → caught below, project skipped.
        await reconcileJobs(project.id, parseCronFile(res.content ?? ""), res.etag, now);
      }
      // 304 → cron_state already current.
      for (const job of await dueJobs(project.id, now)) due.push({ project, job });
    } catch (e) {
      console.error(`cron tick: skipped project ${project.id}:`, (e as Error).message);
    }
  }

  // Phase 2: dispatch up to the per-tick cap. markFired only on a successful
  // hand-off so a failed dispatch retries next tick.
  let dispatched = 0;
  for (const { project, job } of due) {
    if (dispatched >= MAX_RUNS_PER_TICK) break;
    try {
      const res = await fetch(`${origin}/api/cron/run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.CRON_SECRET}`,
        },
        body: JSON.stringify({ projectId: project.id, jobName: job.jobName }),
      });
      if (res.ok) {
        await markFired(project.id, job.jobName, now);
        dispatched++;
      }
    } catch (e) {
      console.error(`cron tick: dispatch failed ${project.id}:${job.jobName}:`, (e as Error).message);
    }
  }

  // Phase 3: dispatch supervisor card cycles, sharing the per-tick sandbox
  // budget with cron.json runs. Eligible = supervised + in_progress + lease-free.
  let supervised = 0;
  const remaining = MAX_RUNS_PER_TICK - dispatched;
  if (remaining > 0) {
    const cardIds = await listEligibleCardIds(now, remaining);
    for (const chatId of cardIds) {
      try {
        const res = await fetch(`${origin}/api/cron/supervise/run`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.CRON_SECRET}`,
          },
          body: JSON.stringify({ chatId }),
        });
        if (res.ok) supervised++;
      } catch (e) {
        console.error(
          `cron tick: supervise dispatch failed ${chatId}:`,
          (e as Error).message,
        );
      }
    }
  }

  return Response.json({
    ok: true,
    projects: projects.length,
    due: due.length,
    dispatched,
    supervised,
    deferred: Math.max(0, due.length - dispatched),
  });
}
