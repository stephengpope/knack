# Knack

Your AI agent. A clean, single-surface chat app where every message runs through
a server-side agent loop with an isolated [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox)
for executing code and shell commands.

Built with **Next.js (App Router)** · **Tailwind v4** · **shadcn/ui** ·
**AI SDK 6** (via **Vercel AI Gateway**) · **Better Auth** · **Drizzle** ·
**Neon Postgres** · **Vercel Sandbox**.

## Features

- 🤖 Server-side agent loop (`ToolLoopAgent`) streamed to the client with AI Elements–style rendering + Streamdown
- 🧰 Sandbox tools: `runBash`, `readFile`, `writeFile`, `listFiles` — one warm microVM per chat
- 🔀 Multi-provider model selector through the AI Gateway (Anthropic, OpenAI, DeepSeek, Moonshot/Kimi) — no per-provider keys
- 💬 Persisted multi-chat history (Postgres) with star / rename / delete
- 🔐 Email + password auth (Better Auth) with branded shadcn screens
- 🌗 Light / dark theme matching the Knack brand
- 🕘 Scheduled agent runs — per-project `cron.json`, driven by a Vercel cron heartbeat

## One-click deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/your-org/knack&project-name=knack&repository-name=knack&env=BETTER_AUTH_SECRET,BETTER_AUTH_URL&envDescription=Auth%20secret%20and%20app%20URL%20%E2%80%94%20see%20.env.example)

After the project is created:

1. **Add a database** — in the project's **Storage** tab, add **Neon Postgres**
   from the Marketplace. This auto-injects `DATABASE_URL`.
2. **Set `BETTER_AUTH_SECRET`** — `openssl rand -base64 32`.
3. **Set `BETTER_AUTH_URL`** — your deployment URL (e.g. `https://knack.vercel.app`).
4. **AI Gateway** — `AI_GATEWAY_API_KEY` is provided automatically on Vercel via OIDC.
5. **Run migrations** — `vercel env pull .env.local` then `pnpm db:migrate`
   (or `pnpm db:push` for the first deploy).

## Local development

```bash
pnpm install
cp .env.example .env.local        # fill in DATABASE_URL + BETTER_AUTH_SECRET
pnpm db:migrate                   # apply schema to your Neon database
pnpm dev
```

Open http://localhost:3000.

### Environment variables

| Variable              | Required | Notes                                                        |
| --------------------- | -------- | ------------------------------------------------------------ |
| `DATABASE_URL`        | ✅       | Neon Postgres connection string (added via Vercel Storage)   |
| `BETTER_AUTH_SECRET`  | ✅       | `openssl rand -base64 32`                                    |
| `BETTER_AUTH_URL`     | ✅       | App base URL, no trailing slash                              |
| `AI_GATEWAY_API_KEY`  | local    | Auto-provided on Vercel via OIDC; set locally for dev        |

## Architecture

```
app/
  (auth)/            login · signup · forgot/reset password   (Better Auth)
  (app)/             protected shell
    layout.tsx       sidebar + session guard
    page.tsx         new-chat welcome state
    c/[chatId]/      conversation (loads persisted messages)
  api/
    agent/route.ts   ToolLoopAgent loop -> sandbox tools -> persist
    auth/[...all]/   Better Auth handler
lib/
  db/                Drizzle schema + Neon client + migrations
  sandbox/           provider-agnostic Sandbox adapter (Vercel impl)
  models.ts          Gateway model registry (selector source of truth)
  auth.ts            Better Auth server
  chats.ts           chat/message persistence (user-scoped)
components/
  chat/              Chat, Composer, MessageList
  app/               Sidebar, AccountMenu
  brand/             logo / mark
  ui/                shadcn primitives
```

The agent runs entirely on the server; sandbox code is isolated in a Firecracker
microVM with no access to your env, database, or cloud resources. Swapping sandbox
providers means adding one adapter under `lib/sandbox/` — nothing else changes.

## Notes / phase 2

- **Password reset email** transport is not configured — wire a `sendResetPassword`
  handler in `lib/auth.ts` to send real links.
- **Scheduled runs** are live: a daily Vercel cron heartbeat (`vercel.json` →
  `/api/cron/tick`) polls each active project's `cron.json` and fires due jobs as
  agent turns. Set `CRON_SECRET`; raise the heartbeat to `*/30 * * * *` (Pro) for
  finer timing.
- Confirm the model slugs in `lib/models.ts` against the live
  [AI Gateway model list](https://vercel.com/ai-gateway/models).
