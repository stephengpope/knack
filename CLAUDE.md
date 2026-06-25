# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

> **Next.js is non-standard here.** This repo runs Next 16 with breaking changes
> from older versions. Read the relevant guide in `node_modules/next/dist/docs/`
> before writing routing/data-fetching/middleware code. Heed deprecation notices.

## Commands

```bash
pnpm dev                 # next dev (http://localhost:3000)
pnpm build               # next build
pnpm lint                # eslint
pnpm db:generate         # drizzle-kit generate — create migration from schema.ts diff
pnpm db:migrate          # apply migrations (loads .env.local)
pnpm db:push             # push schema directly (first deploy / dev)
pnpm db:studio           # drizzle studio
pnpm seed:admin          # seed first admin user (sign-up is disabled; invite-only)
```

No test suite. Package manager is **pnpm** (enforced via `pnpm-workspace.yaml`).
Path alias `@/*` → repo root.

## Architecture

Single-surface AI chat agent. Every message runs a server-side `ToolLoopAgent`
loop with an isolated Vercel Sandbox per chat. Stack: Next 16 App Router · React 19
· Tailwind v4 · shadcn on **Radix UI** · AI SDK 6 via **Vercel AI Gateway**
· Better Auth · Drizzle · Neon Postgres.

### The agent request (`app/api/agent/route.ts` → `lib/agent/run-turn.ts`)
Heart of the app. The route is a thin session gate: auth-gate → parse body →
`runAgentTurn(...)` → stream UI messages → `after()` git sync. **The turn itself
lives in `lib/agent/run-turn.ts`** (`runAgentTurn`): resolve model → resolve
project + GitHub auth → build (or reuse) the system prompt → build sandbox tools →
run `ToolLoopAgent` → return the UI stream (persists on finish) + a `sync`
closure. It takes `userId` as a param (no session coupling) so **cron calls the
same function** — see `### Scheduled runs`. The `sync` closure runs in `after()`:
`lib/git/sync.ts` commits/merges/pushes the box; on conflict `lib/git/fix.ts`
spawns a bounded LLM tool-loop to recover, then verifies clean+pushed independently.
- New chats get a title generated in parallel via the "General AI" model, pushed
  as a transient `data-chat-title` part.
- **System prompt is built once at chat creation and frozen on `chat.systemPrompt`**
  (assembled in `lib/prompt/build.ts`; skills scanned from the repo then); later
  turns reuse it. Composition: `lib/prompt/CLAUDE.md`.
- Tools (all `noun_verb`, snake_case): `bash_run`/`file_read`/`file_write`/
  `file_edit`/`files_list`/`search_files` (sandbox — file logic in
  `lib/files/CLAUDE.md`) · `secrets_list`/`secret_get` (per-user secrets vault) ·
  `skill_load`/`skill_manage`/`skills_list` (project skills — `lib/skills/CLAUDE.md`).
  All sandbox ops go through one box per chat. Tool *definitions* live in
  `lib/agent/run-turn.ts`; each tool with logic delegates to a same-named function.
  Tool schemas reach the model via the AI SDK's tool-calling API — **not** listed
  in the prompt.

### Models & connection modes (`lib/llm.ts`, `lib/settings.ts`)
Models are **gateway `"provider/model"` strings** (dots, e.g. `anthropic/claude-opus-4.8`
— NOT the dashes the direct SDK uses). One shared deployment config (`app_settings`
singleton, admin-managed). `resolveAgentModel` / `resolveGeneralModel` return a
`{ model, providerOptions }` usable directly with `generateText`/agent. Three
`connectionMode`s:
- `gateway` — deployment's hosted gateway key, plain gateway slug.
- `custom` — your own provider keys, called **directly** via the per-provider AI
  SDK packages (`@ai-sdk/openai|anthropic|google|xai|mistral|deepseek`), no
  gateway. `build()` in `lib/llm.ts` maps the model's provider prefix to the
  right client; model ids are stored `provider/<native-id>` and the prefix is
  stripped before the call. Catalog comes from each provider's own `/models`
  (`lib/provider-models.ts`), not the gateway. Only providers with an SDK package
  are offered (Moonshot → use `compatible`). `lib/gateway-byok.ts` is now unused
  by this mode (kept for reference).
- `compatible` — direct OpenAI-compatible endpoint, bypasses the gateway.

> **Don't blame "the gateway" by default.** Only `gateway` mode touches the hosted
> gateway; `custom` and `compatible` are direct provider clients. Mode changes the
> credentials/endpoint/SDK-client — for the same model the call shape is normalized
> by the AI SDK, but `custom`/`compatible` are a genuinely different code path than
> the gateway, so don't assume gateway behavior carries over verbatim. Check
> `app_settings.connection_mode` before attributing anything to routing.

Live model catalog fetched from the gateway in `lib/gateway-models.ts` (server-only);
`lib/models.ts` is client-safe types/helpers only.

### Sandbox (`lib/sandbox/` — details in `lib/sandbox/CLAUDE.md`)
Provider-agnostic adapter; `vercel.ts` is the **only file allowed to import
`@vercel/sandbox`**. One box per chat (`name: chat-${chatId}`, `resume: true`).
New boxes boot from a lazily-built, self-healing **snapshot** (chromium +
agent-browser, ripgrep, firecrawl-cli, 11 built-in skills) instead of installing
inline. Snapshot id/status persist on `app_settings`; CAS build-lock so one builder
wins. Built-in skills (`$HOME/.skills/`) are read-only and merge with project
skills at runtime.

### Projects & GitHub (`lib/projects.ts`, `lib/github/`, `lib/github-account.ts`)
A chat works in a GitHub-backed **project** (chosen at creation). On the first
message the project repo is checked out into the sandbox at `REPO_DIR`
(`/vercel/sandbox`). Creating a project seeds the repo from the bundled prompt
templates (`lib/prompt/defaults/`). GitHub auth is a per-user PAT
(`github_account`), embedded in the clone URL for pull/push. The repo's
`SOUL/AGENT/MEMORY/USER.md` feed the system prompt; `.skills/` feeds skills.

### Scheduled runs / cron (`lib/cron/`, `app/api/cron/`, `vercel.json`)
Each project repo owns a root **`cron.json`** (array of `{name, schedule, prompt,
model?, enabled}`) — the source of truth, agent-editable. A **single** Vercel cron
(`vercel.json` → `/api/cron/tick`, daily by default; Hobby is daily-only, Pro can
go `*/30`/per-minute) is the heartbeat. The tick (CRON_SECRET-gated GET) polls
every `active` project's `cron.json` **ETag-conditionally** (304s are free), keeps
the `cron_state` cache (parsed jobs + precomputed `nextRunAt`) in sync, and
dispatches due jobs (`nextRunAt <= now`, catch-up) to `/api/cron/run`. The worker
re-derives `userId` from `project.userId` (never the body), creates a fresh chat
(`source='cron'`, `sourceRef=projectId:jobName`), and runs the **same**
`runAgentTurn`, draining the stream server-side (no client) inside `after()`.
`cron_state` is a cache only — GitHub is truth. `lib/cron/file.ts` parses/validates;
`lib/cron/state.ts` is the cache layer (uses `cron-parser`, UTC).

### Kanban supervisor (`lib/supervisor/` — details in `lib/supervisor/CLAUDE.md`)
Autonomous agent loops. A **card** is a `chat` row with non-null `kanbanStatus`;
when it's `in_progress` + `supervisorEnabled`, the cron tick dispatches supervisor
cycles (`/api/cron/supervisor/run` → `runSupervisorCycle`). Each cycle claims the
card via a `supervisorLeaseUntil` CAS, checks the per-run budget (`usageEvent` token sum vs
`app_settings.maxRounds`/`maxTokensPerCard`), runs a read-only **verify→decide**
supervisor turn, and on `continue` posts the next prompt to the worker chat via the
same `runAgentTurn`. Board UI: `app/(app)/board/`, `components/board/`.

### Telegram (`lib/telegram/` — details in `lib/telegram/CLAUDE.md`)
Per-user Telegram bot front-end to the **same** `runAgentTurn`. A public webhook
(`app/api/telegram/[userId]/webhook`, gated by secret-token + `from.id` + update
dedup) returns 200 fast and runs the turn in `after()`, locking the chat via
`chat.chatLeaseUntil` (distinct from the supervisor's `supervisorLeaseUntil`).
Replies stream by editing one Telegram message per text segment. `source='telegram'`
chats; per-user config in the `telegram_account` table; outbound via the
`send_message` tool (`lib/messaging/send.ts`). Voice → AssemblyAI (`lib/voice/`).

### System prompt & skills (`lib/prompt/`, `lib/skills/`)
The system prompt is assembled server-side and **frozen per chat** on
`chat.systemPrompt`. Composition + sources: `lib/prompt/CLAUDE.md`. Skills
(`.skills/<name>/SKILL.md`, discovery, the `skill_*` tools): `lib/skills/CLAUDE.md`.

### Auth (`lib/auth.ts`, `middleware.ts`)
Better Auth, email+password, **invite-only** (`disableSignUp: true`; first admin via
`seed:admin`). Admin plugin gates `/administration`. `middleware.ts` does an
**optimistic** cookie-only check (no DB); real validation is in the protected
`(app)/layout.tsx`. Session uses a signed cookie cache to avoid a Neon round-trip
per navigation.

### Encryption (`lib/crypto.ts`)
All secret material (shared API keys, custom-endpoint keys, per-user OAuth/static
secrets) is **AES-256-GCM** encrypted at rest as `iv:tag:ciphertext`, keyed by
`ENCRYPTION_KEY`. Decryption happens only server-side at point of use.

### Data (`lib/db/`)
Drizzle + Neon HTTP driver. `db` is a lazy Proxy so importing never throws at
build time — the connection (and the missing-`DATABASE_URL` error) only resolves
on first query. Schema in `lib/db/schema.ts`: Better Auth tables (`user`/`session`/
`account`/`verification`/`rate_limit`) + app tables (`chat` [carries `projectId`,
the frozen `systemPrompt`, `source`/`sourceRef` for cron/supervisor runs, **and
the kanban+supervisor columns** — `kanbanStatus`, `supervisorEnabled`, `cardSeq`
(from the `card_seq` sequence), `userStory`/`details`, `acceptanceCriteria`/`tasks`/
`testCases` jsonb, `iteration`/`runStartedAt`/`supervisorLeaseUntil`/`chatLeaseUntil`/`max*Override` loop
state], `message`, `usage_event` [per-call token log for supervisor budgets, indexed
`(chatId, createdAt)`], `project` [GitHub-backed workspace; `active` gates cron +
the chat selector], `cron_state` [per-project schedule cache], `github_account`
[per-user PAT], `api_key` shared BYOK, `app_settings` singleton [+ supervisor
budgets `maxRounds`/`maxTokensPerCard` and `sandbox_snapshot_id`/`_status`],
`custom_endpoint`, `user_secret` per-user vault). `user_settings` is **deprecated**
— kept only so migrations stay additive; superseded by `app_settings`. Schema
changes: edit `schema.ts` → `db:generate` → `db:migrate`.

### Routes
- `(auth)/` — login, forgot/reset password, accept-invite.
- `(app)/` — protected shell: `page.tsx` (new chat), `chat/[chatId]`, `chats`,
  `board` (kanban supervisor), `cron` (schedule UI), `settings` (projects +
  per-user secrets), `administration` (admin: users, AI models, secrets).
- `api/` — `agent` (main loop), `cron/tick` (heartbeat dispatcher) + `cron/run`
  (scheduled-run worker) + `cron/supervisor/run` (supervisor cycle worker),
  `auth/[...all]` (Better Auth), `oauth/callback` (user-secret OAuth connections).

Server Actions live next to their pages (`*-actions.ts` / `actions.ts`).

## Gotchas

- **UI conventions: `components/CLAUDE.md`.** shadcn on **Radix UI** (`asChild` is
  supported). The previous "Base UI, no asChild" note was inaccurate.
- `lib/db/index.ts` reads `DATABASE_URL` lazily; don't import-time-assert env.
- `vercel env pull` **overwrites** `.env.local` — re-add `BETTER_AUTH_SECRET`,
  `BETTER_AUTH_URL`, `ENCRYPTION_KEY`, `CRON_SECRET` after. `VERCEL_OIDC_TOKEN` authenticates both
  gateway and sandbox locally.
- Verify model slugs against the live AI Gateway model list — gateway slugs differ
  from direct-SDK ids.

## Phase 2 / known gaps

Password-reset email transport configurable but generic. Cron delivery is
UI-only (runs appear as chats); notify-out (email/webhook), one-shot/repeat
counts, and per-user timezones are deferred.
