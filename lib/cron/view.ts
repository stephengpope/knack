import "server-only";
import { getGithubAuth } from "@/lib/github-account";
import { listActiveProjectsForUser } from "@/lib/projects";
import { latestCronRuns } from "@/lib/chats";
import { getFileContents } from "@/lib/github";
import { CRON_FILE, parseCronFile } from "@/lib/cron/file";
import { cronStateForProjects } from "@/lib/cron/state";

// Read-only assembly for the /cron view. Schedules come LIVE from each active
// project's cron.json (the source of truth — never stale). Next-run is read from
// the dispatcher's cron_state cache (what the scheduler will actually do; null
// until the tick first picks a job up). Last-run + a link come from the most
// recent cron chat for the job. No DB writes.

export type CronJobView = {
  name: string;
  schedule: string;
  enabled: boolean;
  nextRunAt: string | null; // ISO; null when disabled (won't run)
  lastRunAt: string | null; // ISO; null when never run
  lastChatId: string | null; // link to the most recent run
};

export type CronProjectGroup = {
  projectId: string;
  projectName: string;
  repoFullName: string;
  htmlUrl: string;
  hasFile: boolean; // false = no cron.json in the repo
  error: string | null; // GitHub/parse error, if any
  jobs: CronJobView[];
};

export async function getCronView(userId: string): Promise<CronProjectGroup[]> {
  const projects = await listActiveProjectsForUser(userId);
  if (projects.length === 0) return [];

  const [gh, runs, states] = await Promise.all([
    getGithubAuth(userId),
    latestCronRuns(userId),
    cronStateForProjects(projects.map((p) => p.id)),
  ]);

  return Promise.all(
    projects.map(async (p): Promise<CronProjectGroup> => {
      const base = {
        projectId: p.id,
        projectName: p.name,
        repoFullName: p.repoFullName,
        htmlUrl: p.htmlUrl,
      };

      if (!gh) {
        return { ...base, hasFile: false, error: "GitHub not connected.", jobs: [] };
      }

      let text: string | null;
      try {
        text = await getFileContents(
          gh.pat,
          p.repoOwner,
          p.repoName,
          CRON_FILE,
          p.defaultBranch,
        );
      } catch (e) {
        return { ...base, hasFile: false, error: (e as Error).message, jobs: [] };
      }
      if (text === null) {
        return { ...base, hasFile: false, error: null, jobs: [] };
      }

      let jobs: CronJobView[];
      try {
        jobs = parseCronFile(text).map((j) => {
          const ref = `${p.id}:${j.name}`;
          const run = runs.get(ref);
          const state = states.get(ref);
          return {
            name: j.name,
            schedule: j.schedule,
            enabled: j.enabled,
            // From cron_state: the scheduler's actual next fire time. Null until
            // the tick first picks the job up (or when disabled).
            nextRunAt:
              j.enabled && state ? state.nextRunAt.toISOString() : null,
            lastRunAt: run ? run.at.toISOString() : null,
            lastChatId: run ? run.chatId : null,
          };
        });
      } catch (e) {
        return { ...base, hasFile: true, error: (e as Error).message, jobs: [] };
      }

      return { ...base, hasFile: true, error: null, jobs };
    }),
  );
}
