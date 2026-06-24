# Kanban supervisor (`lib/supervisor/`)

Autonomous agent loops. A **card** is just a `chat` row with non-null
`kanbanStatus` (`todo|in_progress|blocked|review|done`) — there is **no separate
card/board table**. When a card is `in_progress` **and** `supervisorEnabled`, a
background **supervisor** loop drives the worker chat round after round until it
decides `review` / `blocked` / budget runs out.

## The loop (one cycle = `runSupervisorCycle(chatId)` in `run.ts`)
Heartbeat is the **same cron tick** (`app/api/cron/tick`). After cron jobs, the
tick calls `listEligibleCardIds(now, remaining)` and POSTs each to
`app/api/cron/supervisor/run` (CRON_SECRET-gated), which runs the cycle inside
`after()` (returns 202 immediately). One cycle:
1. **`claimCard`** (`select.ts`) — atomic CAS on `leaseUntil`. Loses → another
   runner has it, return. Lease = `MAX_RUN_SECONDS + 120s` (`constants.ts`), so a
   killed cycle isn't reclaimed for ~30 min (correctness over fast retry).
2. **Budget guard** — `iteration >= maxRounds` or run-token-sum `>= maxTokens` →
   set `blocked` + return. Budget is **per-run**, summed from `usageEvent` where
   `createdAt >= runStartedAt`. Caps: `chat.maxRoundsOverride` / `maxTokensOverride`,
   else `app_settings.maxRounds` (25) / `maxTokensPerCard` (2M).
3. **`runSupervisorTurn`** (`turn.ts`) — two phases:
   - **VERIFY** — free-form reasoning with **read-only** file tools
     (`file_read`/`files_list`/`search_files`) over the worker's box; persisted to
     the supervisor chat.
   - **DECIDE** — forced structured output (`generateObject`, no tools) →
     `{verdict, nextPrompt, blockedReason?, updated checklists?}`. Split so "model
     forgot to call the tool" can't corrupt the decision.
4. **Act on verdict**: `continue` → post `nextPrompt` as a user message to the
   **worker** chat and call `runAgentTurn` (drained server-side, no client);
   `review`/`blocked` → set status (+ `blockedReason`). Checklists, if returned,
   **fully replace** `acceptanceCriteria`/`tasks`/`testCases`.
5. **`releaseLease`** unless blocked/review.

## Files
- `run.ts` — orchestrates one cycle (claim → budget → turn → act → release).
- `select.ts` — `claimCard`/`releaseLease` (lease CAS) + `listEligibleCardIds`
  (`supervisorEnabled && status='in_progress' && lease free`).
- `turn.ts` — the supervisor review turn (VERIFY + DECIDE). Read-only box.
- `chat.ts` — get/create the **supervisor's hidden chat** (`source='supervisor'`,
  `sourceRef=<worker chatId>`; frozen system prompt from the repo's `SUPERVISOR.md`).
- `prompt.ts` — renders the per-round contract (card fields + worker's recent 3
  text messages) and loads `SUPERVISOR.md` (seeded from
  `lib/prompt/defaults/DEFAULT_SUPERVISOR.md`).
- `constants.ts` — `MAX_RUN_SECONDS` (1800), `LEASE_MS`.

## Invariants
- **Card = chat row.** Kanban/supervisor columns live on `chat` (see
  `lib/db/schema.ts`): `kanbanStatus`, `supervisorEnabled`, `cardSeq` (KNK-`<n>`
  from the `card_seq` sequence), `userStory`/`details`, `acceptanceCriteria`/
  `tasks`/`testCases` (jsonb), `activeRole`, `blockedReason`, `iteration`,
  `runStartedAt`, `lastRunAt`, `leaseUntil`, `maxRoundsOverride`/`maxTokensOverride`.
- **Budget resets per run.** Moving a card to `in_progress` zeroes `iteration` and
  sets `runStartedAt = now` (board action) — restart = fresh budget.
- **Reuses the public agent API.** The supervisor never reaches into agent
  internals; worker turns go through `runAgentTurn` like any chat.
- **Supervisor chat is hidden** — not in the sidebar; surfaced only via the board's
  "Supervisor Logs". Its system prompt is frozen at creation.
- **Lease is a timestamp, not a lock.** Double-dispatch is tolerated; the CAS makes
  exactly one win.

## UI
`app/(app)/board/page.tsx` + `actions.ts` (`createCard`/`updateCard`/`setSupervise`/
`removeFromBoard`/`loadSupervisorChat`). Components in `components/board/`.
Per-run budget telemetry (`usageEvent` table, one row per worker/supervisor call,
indexed `(chatId, createdAt)`) drives the card's loop-bookkeeping display.
