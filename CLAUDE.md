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

### The agent request (`app/api/agent/route.ts`)
Heart of the app. Per POST: auth-gate → resolve model → resolve project + GitHub
auth → build (or reuse) the system prompt → build sandbox tools → run
`ToolLoopAgent` → stream UI messages → persist on finish.
- `maxDuration = 300`. New chats get a title generated in parallel via the
  "General AI" model, pushed as a transient `data-chat-title` part.
- **System prompt is built once at chat creation and frozen on `chat.systemPrompt`**
  (assembled in `lib/prompt/build.ts`; skills scanned from the repo then); later
  turns reuse it. Composition: `lib/prompt/CLAUDE.md`.
- Tools (all `noun_verb`, snake_case): `bash_run`/`file_read`/`file_write`/
  `file_edit`/`files_list`/`search_files` (sandbox — file logic in
  `lib/files/CLAUDE.md`) · `secrets_list`/`secret_get` (per-user secrets vault) ·
  `skill_load`/`skill_manage`/`skills_list` (project skills — `lib/skills/CLAUDE.md`).
  All sandbox ops go through one box per chat. Tool *definitions* live here in
  route.ts; each tool with logic delegates to a same-named function. Tool schemas
  reach the model via the AI SDK's tool-calling API — **not** listed in the prompt.

### Models & connection modes (`lib/llm.ts`, `lib/settings.ts`)
Models are **gateway `"provider/model"` strings** (dots, e.g. `anthropic/claude-opus-4.8`
— NOT the dashes the direct SDK uses). One shared deployment config (`app_settings`
singleton, admin-managed). `resolveAgentModel` / `resolveGeneralModel` return a
`{ model, providerOptions }` usable directly with `generateText`/agent. Three
`connectionMode`s:
- `gateway` — deployment's hosted gateway key, plain slug.
- `custom` — shared provider keys (BYOK) injected as `providerOptions.gateway.byok`
  (`lib/gateway-byok.ts`); same gateway namespace, just different credentials.
- `compatible` — direct OpenAI-compatible endpoint, bypasses the gateway.

Live model catalog fetched from the gateway in `lib/gateway-models.ts` (server-only);
`lib/models.ts` is client-safe types/helpers only.

### Sandbox (`lib/sandbox/`)
Provider-agnostic adapter. `lib/sandbox/vercel.ts` is the **only file allowed to
import `@vercel/sandbox`**. One sandbox per chat (`name: chat-${chatId}`,
`resume: true`) — SDK reconnects to a live session or creates fresh, no local
cache, works across function instances. Swap providers = add one adapter, nothing
else changes.

### Projects & GitHub (`lib/projects.ts`, `lib/github/`, `lib/github-account.ts`)
A chat works in a GitHub-backed **project** (chosen at creation). On the first
message the project repo is checked out into the sandbox at `REPO_DIR`
(`/vercel/sandbox`). Creating a project seeds the repo from the bundled prompt
templates (`lib/prompt/defaults/`). GitHub auth is a per-user PAT
(`github_account`), embedded in the clone URL for pull/push. The repo's
`SOUL/AGENT/MEMORY/USER.md` feed the system prompt; `.skills/` feeds skills.

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
`account`/`verification`/`rate_limit`) + app tables (`chat` [carries `projectId` +
the frozen `systemPrompt`], `message`, `project` [GitHub-backed workspace],
`github_account` [per-user PAT], `api_key` shared BYOK, `app_settings` singleton,
`custom_endpoint`, `user_secret` per-user vault). `user_settings` is **deprecated**
— kept only so migrations stay additive; superseded by `app_settings`. Schema
changes: edit `schema.ts` → `db:generate` → `db:migrate`.

### Routes
- `(auth)/` — login, forgot/reset password, accept-invite.
- `(app)/` — protected shell: `page.tsx` (new chat), `chat/[chatId]`, `chats`,
  `settings` (projects + per-user secrets), `administration` (admin: users, AI
  models, secrets).
- `api/` — `agent` (main loop), `auth/[...all]` (Better Auth), `oauth/callback`
  (user-secret OAuth connections).

Server Actions live next to their pages (`*-actions.ts` / `actions.ts`).

## Gotchas

- **UI conventions: `components/CLAUDE.md`.** shadcn on **Radix UI** (`asChild` is
  supported). The previous "Base UI, no asChild" note was inaccurate.
- `lib/db/index.ts` reads `DATABASE_URL` lazily; don't import-time-assert env.
- `vercel env pull` **overwrites** `.env.local` — re-add `BETTER_AUTH_SECRET`,
  `BETTER_AUTH_URL`, `ENCRYPTION_KEY` after. `VERCEL_OIDC_TOKEN` authenticates both
  gateway and sandbox locally.
- Verify model slugs against the live AI Gateway model list — gateway slugs differ
  from direct-SDK ids.

## Phase 2 / known gaps

Cron view stubbed. Password-reset email transport configurable but generic.
