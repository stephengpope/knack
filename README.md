# Knack

**Knack is a self-improving AI agent for EVERYONE (non technical people). It requires no local computer or cloud server. Billed only when you use it (and includes a free tier). Installs in 1 click.**

- 🧠 **Self-improving** — the agent owns a GitHub repo with its prompt, memory,
  skills, and cron schedule, and rewrites them as it learns.
- ☁️ **No local machine or VM** — each chat gets a fresh cloud sandbox. Nothing
  runs on your laptop.
- 💸 **Pay only for what you use, with a free tier** — Vercel Hobby and Neon free
  Postgres cost nothing at rest. AI runs through the Vercel AI Gateway — new
  accounts get $5 in credits each month.
- 📎 **File attachments** — attach images, PDFs, text, and zips to a chat (or send
  them via Telegram). Images and PDFs are shown inline and seen by the model; every
  file lands in the sandbox's `.attachments/` for the agent to work with. Backed by
  a private Vercel Blob store. Unstarred chats (and their attachments) are
  auto-deleted after the retention window — default **7 days**, configurable in
  **Administration** (`0` disables).
- 🚀 **One-click install** — the button below clones the repo, provisions the
  database and Blob storage, and deploys.

---

## Cost & free tier

| Service           | Free tier                              | Billed when                          |
| ----------------- | -------------------------------------- | ------------------------------------ |
| [Vercel (Hobby)](https://vercel.com/pricing)    | Yes — hosting, functions, sandbox      | You exceed Hobby limits / go Pro     |
| [Neon Postgres](https://neon.com/pricing)     | Yes — free serverless Postgres         | You outgrow the free database        |
| [Vercel Blob](https://vercel.com/docs/vercel-blob/usage-and-pricing)       | Yes — chat file attachments (images, PDFs, docs) stored free on Hobby within its limits, with no overage | You exceed the Hobby limits or go Pro — then **$0.023/GB‑mo** storage and **$0.05/GB** transfer (Pro includes 5 GB + 100 GB; deletes are free, and storage stays bounded by the retention policy) |
| [AI (AI Gateway)](https://vercel.com/docs/ai-gateway/pricing)   | $5 credits/mo on new accounts          | Per token once the free credits run out |

Scheduled runs and the supervisor depend on cron frequency: Vercel **Hobby** runs
cron **once a day**; **Pro** allows finer schedules (e.g. every 30 minutes).

---

## Installation

### 1. Click the button

<a href="https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fstephengpope%2Fknack&project-name=knack&repository-name=knack&stores=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22neon%22%2C%22productSlug%22%3A%22neon%22%2C%22protocol%22%3A%22storage%22%7D%2C%7B%22type%22%3A%22blob%22%2C%22access%22%3A%22private%22%7D%5D&env=BETTER_AUTH_SECRET%2CENCRYPTION_KEY%2CCRON_SECRET&envDescription=Generate+all+three+secrets+with+one+copy-paste+command+%28Mac%2FLinux+or+Windows%29+%E2%80%94+click+%27Learn+more%27.&envLink=https%3A%2F%2Fgithub.com%2Fstephengpope%2Fknack%233-generate-the-secrets" target="_blank" rel="noopener noreferrer"><img src="https://vercel.com/button" alt="Deploy with Vercel"></a>

Name the repo (or keep `knack`) and click **Create**.

### 2. Add the stores (Neon + Blob)

Both are preselected — click **Add** on each. **Neon** creates a free Postgres
database and wires up `DATABASE_URL`; the **private Blob** store (for chat file
attachments) wires up `BLOB_READ_WRITE_TOKEN`. Nothing to copy.

### 3. Generate the secrets

Run the command for your OS. It prints three labelled values — copy each (the
part **after the `=`**) into the form field of the same name.

**Mac / Linux** (Terminal):

```bash
printf '\n\nBETTER_AUTH_SECRET = %s\n\nENCRYPTION_KEY     = %s\n\nCRON_SECRET        = %s\n\n' "$(openssl rand -base64 32)" "$(openssl rand -base64 32)" "$(openssl rand -hex 32)"
```

**Windows** (PowerShell):

```powershell
"`n`nBETTER_AUTH_SECRET = $([Convert]::ToBase64String([byte[]](1..32|%{Get-Random -Maximum 256})))`n`nENCRYPTION_KEY     = $([Convert]::ToBase64String([byte[]](1..32|%{Get-Random -Maximum 256})))`n`nCRON_SECRET        = $(-join((1..32|%{'{0:x2}' -f (Get-Random -Maximum 256)})))`n"
```

Then click **Deploy**.

### 4. Create the first admin

Once it's live, open `/login` — a fresh install shows a **"Set up Knack"** form.
Create your admin there. After that `/login` is a normal sign-in (sign-up is
invite-only; admins invite others from **Administration**).

### 5. Connect a GitHub repo

In **Settings**, add a GitHub Personal Access Token (`repo` scope) and create a
**project** — Knack seeds it with starter prompt/memory/skills files and works
inside it. Start a chat.

---

## Environment variables

The Deploy Button handles the rest of these for you; this table is the full
reference for self-hosting or local development.

| Variable             | Required | Source                                                                 |
| -------------------- | -------- | ---------------------------------------------------------------------- |
| `DATABASE_URL`       | ✅        | **Auto** — Neon store created by the Deploy Button. Or your own Neon connection string. |
| `BLOB_READ_WRITE_TOKEN` | ✅     | **Auto** — private Blob store created by the Deploy Button. Backs chat file attachments. |
| `BETTER_AUTH_SECRET` | ✅        | `openssl rand -base64 32`                                              |
| `ENCRYPTION_KEY`     | ✅        | `openssl rand -base64 32`                                              |
| `CRON_SECRET`        | ✅        | `openssl rand -hex 32` — guards scheduled-run endpoints.              |
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
#    and a short-lived VERCEL_OIDC_TOKEN.
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
