# Scheduled runs / cron (`lib/cron/`, `app/api/cron/`)

Each project repo owns a root **`cron.json`** (array of `{name, schedule, prompt,
model?, enabled}`) — the **source of truth**, agent-editable. A **single** Vercel
cron (`vercel.json` → `GET /api/cron/tick`, CRON_SECRET-gated; daily by default —
Hobby is daily-only, Pro can go `*/30`/per-minute) is the heartbeat that drives
everything below. `cron_state` is a **cache only**; GitHub is truth.

## The tick (`app/api/cron/tick/route.ts`) runs 4 phases
1. **Refresh + collect.** For each `active` project: fetch its `cron.json`
   **ETag-conditionally** via `github/getFileContentsConditional` (304s are free /
   rate-limit-free), `reconcileJobs` into the cache, then `dueJobs(projectId, now)`
   (`nextRunAt <= now`, catch-up).
2. **Dispatch jobs** (up to a per-tick cap) → `POST /api/cron/run`. `markFired`
   only on successful dispatch. The worker re-derives `userId` from `project.userId`
   (never the body), creates a fresh chat (`source='cron'`, `sourceRef=projectId:jobName`),
   and runs the **same** `runAgentTurn`, draining the stream server-side (no client)
   inside `after()`.
3. **Dispatch supervisor cycles** → `POST /api/cron/supervisor/run` for each
   `listEligibleCardIds(now, remaining)`. See `lib/supervisor/CLAUDE.md`.
4. **Retention sweep** → `sweepExpiredChats(now, retentionDays)` from
   `lib/retention/sweep.ts` (deletes unstarred chats whose `updatedAt` is older than
   `app_settings.retentionDays`; cascades supervisor chats + `deleteChatBlobs`;
   `retentionDays <= 0` disables it).

## Files
- `file.ts` — parse/validate `cron.json` (`parseCronFile`, `CRON_FILE`) + schedule
  math (`nextRunAfter`, `isValidCron`; `cron-parser`, **UTC**). File-agnostic, no DB.
- `state.ts` — the cache layer over `cron_state`: `getStoredEtag`, `reconcileJobs`,
  `dueJobs`, `markFired`, `getJob`, `cronStateForProjects`, `clearJobs`.
- `view.ts` — read-only assembly for the `/cron` UI page (`getCronView(userId)`):
  schedules **live** from `cron.json`, next-run from the cache, last-run from chat
  history. Reads only.

## Gotchas
- **Cache is never authoritative.** If `cron.json` changes, the ETag-conditional
  fetch + `reconcileJobs` re-syncs; don't read schedules from `cron_state` for
  display (use `view.ts`, which re-reads the file).
- Times are **UTC** end-to-end; per-user timezones are deferred (see main CLAUDE.md
  Phase 2). Note-out (email/webhook) is deferred too — runs only surface as chats.
