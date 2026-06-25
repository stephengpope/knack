# Knack

**A self-improving AI agent that requires no local computer or virtual machine, billed only when you use it (with a free tier) that installs in 1 click.**

Knack is a single-surface AI chat agent that lives in the cloud. Every message
runs a real tool-using agent inside an isolated [Vercel Sandbox](https://vercel.com/docs/vercel-sandbox)
microVM — it can run shell commands, read and write files, search the web, and
commit code to a GitHub repo it owns. Because that repo holds the agent's own
prompt, memory, skills, and schedule, **Knack edits itself**: give it feedback and
it rewrites its `SOUL/AGENT/MEMORY` files, adds new skills, and schedules its own
recurring jobs.

- 🧠 **Self-improving** — the agent owns a GitHub repo with its prompt, memory,
  skills, and cron schedule, and rewrites them as it learns.
- ☁️ **No local machine or VM** — each chat gets a fresh cloud sandbox. Nothing
  runs on your laptop.
- 💸 **Pay only for what you use, with a free tier** — Vercel Hobby, Neon free
  Postgres, and Resend's free email tier cost nothing at rest. AI runs through the
  Vercel AI Gateway, billed per token only when the agent actually works.
- 🚀 **One-click install** — the button below clones the repo, provisions the
  database, and deploys. You paste a few secrets and you're live.

---

## Deploy

<a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fstephengpope%2Fknack&project-name=knack&repository-name=knack&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%2C%22protocol%22%3A%22storage%22%7D%5D&integration-ids=oac_KfIFnjXqCl4YJCHnt1bDTBI1&skippable-integrations=1&env=BETTER_AUTH_SECRET%2CENCRYPTION_KEY%2CCRON_SECRET%2CRESEND_FROM&envDefaults=%7B%22RESEND_FROM%22%3A%22Knack+%3Conboarding%40resend.dev%3E%22%7D&envDescription=Generate+the+three+secrets+with+one+copy-paste+command+%28Mac%2FLinux+or+Windows%29+%E2%80%94+click+%27Learn+more%27.+RESEND_FROM+is+prefilled.&envLink=https%3A%2F%2Fgithub.com%2Fstephengpope%2Fknack%232-paste-four-values" target="_blank" rel="noopener noreferrer"><img src="https://vercel.com/button" alt="Deploy with Vercel"></a>

Clicking it will:

1. **Clone** this repo into your GitHub account.
2. **Add integrations** — **Neon** (required: Postgres → `DATABASE_URL`) and
   **Resend** (optional: email → `RESEND_API_KEY`). One click each; both inject
   their keys for you.
3. **Ask for four values** (below) — generated secrets, no website visits.
4. **Build and deploy**, running database migrations automatically.

Everything else — the cloud sandbox, the AI Gateway, and the deployment URL — is
configured for you by the Vercel platform.

### 1. Add the integrations

During the flow Vercel shows **Neon** and **Resend** — click to add each:

- **Neon** (required) provisions a free Postgres database and wires `DATABASE_URL`.
- **Resend** (optional) connects an email account and injects `RESEND_API_KEY` —
  no key to copy from anywhere. Powers invites and password-reset emails. Skip it
  and the app falls back to copyable invite links (no emails sent).

### 2. Paste four values

When the deploy form asks for environment variables, generate all three secrets
with one command — it prints them labelled and spaced, ready to paste.

**Mac / Linux** (Terminal):

```bash
printf '\n\nBETTER_AUTH_SECRET = %s\n\nENCRYPTION_KEY     = %s\n\nCRON_SECRET        = %s\n\n' "$(openssl rand -base64 32)" "$(openssl rand -base64 32)" "$(openssl rand -hex 32)"
```

**Windows** (PowerShell):

```powershell
"`n`nBETTER_AUTH_SECRET = $([Convert]::ToBase64String([byte[]](1..32|%{Get-Random -Maximum 256})))`n`nENCRYPTION_KEY     = $([Convert]::ToBase64String([byte[]](1..32|%{Get-Random -Maximum 256})))`n`nCRON_SECRET        = $(-join((1..32|%{'{0:x2}' -f (Get-Random -Maximum 256)})))`n"
```

| Variable             | What to enter                                                                 |
| -------------------- | ----------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET` | First line from the command above. Signs auth sessions.                       |
| `ENCRYPTION_KEY`     | Second line. Encrypts stored provider keys (AES-256-GCM).                     |
| `CRON_SECRET`        | Third line. Guards the scheduled-run endpoints.                               |
| `RESEND_FROM`        | Pre-filled with `Knack <onboarding@resend.dev>`. Leave it, or use a verified sender. |

> **Email note:** `onboarding@resend.dev` only delivers to the email on your
> Resend account — fine for the first admin. To invite teammates, [verify a
> domain](https://resend.com/domains) in Resend and set `RESEND_FROM` to an
> address on it.

### 3. Create the first admin

Open your new deployment and go to **`/login`**. On a fresh install it shows a
**"Set up Knack"** form — create your admin account there. After that, `/login`
becomes a normal sign-in page (sign-up is invite-only; admins invite everyone
else from **Administration**).

### 4. Connect a GitHub repo

In **Settings**, connect a GitHub Personal Access Token (`repo` scope) and create
a **project**. Knack seeds the repo with starter prompt/memory/skills files and
works inside it — this is the repo the agent improves over time.

You're done. Start a chat.

---

## Environment variables

The Deploy Button handles the rest of these for you; this table is the full
reference for self-hosting or local development.

| Variable             | Required | Source                                                                 |
| -------------------- | -------- | ---------------------------------------------------------------------- |
| `DATABASE_URL`       | ✅        | **Auto** — Neon store created by the Deploy Button. Or your own Neon connection string. |
| `BETTER_AUTH_SECRET` | ✅        | `openssl rand -base64 32`                                              |
| `ENCRYPTION_KEY`     | ✅        | `openssl rand -base64 32`                                              |
| `CRON_SECRET`        | ✅        | `openssl rand -hex 32` — guards scheduled-run endpoints.              |
| `RESEND_API_KEY`     | —        | **Auto** — Resend integration added by the Deploy Button (or your own key). Email (invites + password resets); without it, the app falls back to copyable links. |
| `RESEND_FROM`        | —        | Sender address. Prefilled `Knack <onboarding@resend.dev>`; use a [verified domain](https://resend.com/domains) to email anyone but yourself. |
| `BETTER_AUTH_URL`    | —        | **Auto** on Vercel (deployment URL). Set to `http://localhost:3000` locally. |
| `AI_GATEWAY_API_KEY` | —        | **Auto** on Vercel via OIDC. Set locally from [ai-gateway.vercel.sh](https://ai-gateway.vercel.sh). |
| `SNAPSHOT_TTL`       | —        | Optional — days a chat's sandbox snapshot is kept before auto-expiry. Default `1`. |

Voice dictation (AssemblyAI) is optional and configured in-app under
**Administration** once deployed.

Built-in tokens (e.g. the web scrape/search tools in the sandbox) are set in-app,
not via env: per user under **Settings → Secrets**, or once for everyone by an
admin under **Administration → Secrets** (cascades to all users; a user's own
value overrides it).

---

## What you get

- **AI chat agent** with a sandboxed toolchain (bash, file read/write/edit,
  search, web tools) — one isolated cloud box per chat.
- **Projects** backed by your GitHub repos; the agent commits its work and syncs.
- **Skills** the agent can load and author (`.skills/` in the project repo).
- **Scheduled runs** via a root `cron.json` the agent can edit (`vercel.json`
  drives a single Vercel cron heartbeat).
- **Kanban supervisor** — autonomous agent loops that drive cards to completion.
- **Admin console** — users, AI model/provider config, and secrets.

Stack: Next.js 16 (App Router) · React 19 · Tailwind v4 · shadcn on Radix UI ·
AI SDK 6 via Vercel AI Gateway · Better Auth · Drizzle · Neon Postgres ·
Vercel Sandbox.

---

## Cost & free tier

| Service           | Free tier                              | Billed when                          |
| ----------------- | -------------------------------------- | ------------------------------------ |
| Vercel (Hobby)    | Yes — hosting, functions, sandbox      | You exceed Hobby limits / go Pro     |
| Neon Postgres     | Yes — free serverless Postgres         | You outgrow the free database        |
| Resend            | Yes — free email tier                  | You exceed the free send volume      |
| AI (AI Gateway)   | —                                      | Per token, **only when the agent runs** |

Scheduled runs and the supervisor depend on cron frequency: Vercel **Hobby** runs
cron **once a day**; **Pro** allows finer schedules (e.g. every 30 minutes).

---

## Local development (using Vercel database)

Knack is built for the cloud, but you can run the Next.js app on your laptop
against your **deployed** Vercel project — same database, same secrets, same
sandbox. **Deploy first** (above), then pull that project's environment down.

Don't hand-write `.env.local`. The app encrypts stored credentials with
`ENCRYPTION_KEY` and signs sessions with `BETTER_AUTH_SECRET`, so local must use
the **exact** values your deployment uses or it can't read its own data. Pulling
guarantees that; freshly generated local secrets would fail to decrypt rows
written by production.

Prerequisites: the [Vercel CLI](https://vercel.com/docs/cli)
(`pnpm add -g vercel`) and `pnpm`.

```bash
# 1. Link this checkout to your Vercel project (once).
vercel link

# 2. Pull the deployment's env into .env.local — DATABASE_URL, the secrets,
#    Resend, and a short-lived VERCEL_OIDC_TOKEN.
vercel env pull .env.local

# 3. The only value that differs locally is the base URL. `vercel env pull`
#    overwrites .env.local, so keep this in .env.development.local — Next loads
#    it in dev at higher precedence and the pull never touches it.
echo 'BETTER_AUTH_URL=http://localhost:3000' >> .env.development.local

# 4. Install and run.
pnpm install
pnpm dev            # http://localhost:3000
```

What the pulled env gives you:

- `DATABASE_URL` → your Neon database. Migrations already ran on deploy; after you
  edit `lib/db/schema.ts`, run `pnpm db:generate && pnpm db:migrate`.
- `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET` → identical to production,
  so sessions and stored secrets decrypt.
- `VERCEL_OIDC_TOKEN` → authenticates the **Vercel Sandbox** (and the AI Gateway)
  from your laptop. It **expires in ~12 hours** — re-run `vercel env pull`, or use
  `vercel dev` instead of `pnpm dev`, to refresh it. Without a valid token, chats
  can't start a sandbox.

Notes:

- **You share one database with production by default.** Simplest, but local
  changes (new users, chats, migrations) hit live data. To isolate, create a
  [Neon branch](https://neon.com/docs/guides/branching) and point `DATABASE_URL`
  at it in `.env.development.local`.
- You don't need `AI_GATEWAY_API_KEY` locally — the OIDC token covers the gateway,
  and custom/compatible provider keys live in the database (set under
  **Administration**).
- Created your admin via the deployment's **"Set up Knack"** screen? It's in the
  shared DB, so log in locally with it. Otherwise run `pnpm seed:admin`.

---

## Local development (bring your own database)

If you'd rather not link a Vercel project, run fully standalone against your own
Postgres. Note the agent's sandbox still needs Vercel credentials
(`VERCEL_OIDC_TOKEN` or `vercel dev`) to boot.

```bash
pnpm install
cp .env.example .env.local      # fill in DATABASE_URL + the secrets
pnpm db:migrate                 # apply migrations
pnpm dev                        # http://localhost:3000
```

Then open `/login` to create the first admin (same flow as production). See
[`CLAUDE.md`](./CLAUDE.md) for architecture and the per-directory `CLAUDE.md`
guides for subsystem details.

> **Note:** This repo runs **Next.js 16** with breaking changes from older
> versions. See [`AGENTS.md`](./AGENTS.md).
