# 1-Click Deploy — how it works and how it was built

This documents the **Deploy with Vercel** button in `README.md`: what each piece
does, how the integrations are wired, and the non-obvious things learned while
setting it up. Goal: a future session (or human) can pick this up and change it
confidently without re-deriving everything.

---

## TL;DR

The button provisions a full Knack install in one flow:

1. **Neon** (Postgres) — auto-provisioned, **required**. Injects `DATABASE_URL`.
2. **Resend** (email) — auto-provisioned, **optional/skippable**. Injects
   `RESEND_API_KEY`.
3. **Four env values** the installer pastes: `BETTER_AUTH_SECRET`,
   `ENCRYPTION_KEY`, `CRON_SECRET` (generated) + `RESEND_FROM` (prefilled).
4. Build + deploy; migrations run automatically (`scripts/migrate.mjs` in the
   `build` script).

Email is **optional by design** — `lib/email.ts` no-ops gracefully when Resend
isn't configured, and invites fall back to copyable links.

---

## The two integration mechanisms (the key insight)

Vercel has **two different kinds** of Marketplace integration, wired into the
Deploy Button **two different ways**. Getting this wrong wastes hours.

| | **Native integration** | **Connectable account (OAuth)** |
|---|---|---|
| Example | **Neon**, Upstash, Blob | **Resend**, most messaging/3rd-party |
| What it does | Provisions a **resource** (a DB, a store) | Connects an account, sets env vars |
| Deploy-button param | `stores=[{integrationSlug, productSlug, protocol}]` | `integration-ids=oac_…` |
| Identifier | public **slug** (`neon`/`neon`) | public **`oac_` id** |
| `vercel integration discover <name>` | **finds it** | **finds nothing** |
| `vercel integration add <name>` (CLI) | works | "not a Marketplace integration" |

**Resend is a connectable-account/OAuth integration** (Messaging category). It
does NOT provision a resource, so it can't go in `stores` and has no
`productSlug`. It is wired via `integration-ids` using its public `oac_` id.

> The whole "I need your account to get the id" detour was wrong: the `oac_` id is
> **public and global** (same for everyone), not account-specific. Don't read it
> from an installed integration; get it from the public marketplace page (below).

---

## Current Deploy Button URL (decoded)

`README.md` holds the URL-encoded version. Decoded params:

| Param | Value | Purpose |
|---|---|---|
| `repository-url` | `https://github.com/stephengpope/knack` | repo to clone |
| `project-name` / `repository-name` | `knack` | defaults |
| `stores` | `[{"type":"integration","integrationSlug":"neon","productSlug":"neon","protocol":"storage"}]` | provision Neon DB → `DATABASE_URL` |
| `integration-ids` | `oac_KfIFnjXqCl4YJCHnt1bDTBI1` | **Resend** integration (public id) |
| `skippable-integrations` | `1` | makes `integration-ids` (Resend) **optional** — installer can skip email |
| `env` | `BETTER_AUTH_SECRET,ENCRYPTION_KEY,CRON_SECRET,RESEND_FROM` | values prompted on the form |
| `envDefaults` | `{"RESEND_FROM":"Knack <onboarding@resend.dev>"}` | prefills the sender |
| `envDescription` | inline `openssl` instructions | shown on the form — **self-contained, no link back to the repo** |

**Do NOT add** `RESEND_API_KEY` to `env` — the Resend integration injects it.
**Do NOT add** `envLink` — it previously linked the deploy form back to this
repo's README (circular); the instructions are inline in `envDescription` now.

### Required vs optional email

- Remove `skippable-integrations=1` → Resend becomes **required** (installer must
  connect it to deploy). Use this if you want email guaranteed.
- Keep `skippable-integrations=1` → Resend is **optional** (current choice, since
  email degrades gracefully).

---

## Regenerate the URL

Don't hand-edit the URL-encoded string. Regenerate it (correct encoding):

```bash
node -e '
const p = new URLSearchParams();
p.set("repository-url", "https://github.com/stephengpope/knack");
p.set("project-name", "knack");
p.set("repository-name", "knack");
p.set("stores", JSON.stringify([{type:"integration",integrationSlug:"neon",productSlug:"neon",protocol:"storage"}]));
p.set("integration-ids", "oac_KfIFnjXqCl4YJCHnt1bDTBI1");
p.set("skippable-integrations", "1");
p.set("env", "BETTER_AUTH_SECRET,ENCRYPTION_KEY,CRON_SECRET,RESEND_FROM");
p.set("envDefaults", JSON.stringify({RESEND_FROM:"Knack <onboarding@resend.dev>"}));
p.set("envDescription", "BETTER_AUTH_SECRET and ENCRYPTION_KEY: run `openssl rand -base64 32` (once each). CRON_SECRET: run `openssl rand -hex 32`. RESEND_FROM is prefilled.");
console.log("https://vercel.com/new/clone?" + p.toString());
'
```

Paste the output into the `<a href="…">` in `README.md` (the "Deploy" section).

---

## How the Resend `oac_` id was found (and how to re-verify)

It's public — scrape it from the marketplace page. No login, no account:

```bash
# Both return the same id; the marketplace page has it ~93×, zero other ids.
curl -sL "https://vercel.com/marketplace/resend"      | grep -oiE 'oac_[A-Za-z0-9]+' | sort | uniq -c
curl -sL "https://vercel.com/integrations/resend/new" | grep -oiE 'oac_[A-Za-z0-9]+' | sort | uniq -c
# → oac_KfIFnjXqCl4YJCHnt1bDTBI1
```

To wire a **different** OAuth integration into the button, find its `oac_` the
same way from its `vercel.com/marketplace/<slug>` page. (For a **native**
integration, use `vercel integration discover <name>` and wire it via `stores`
with its slug instead.)

---

## Email specifics (`lib/email.ts`)

- `emailConfigured()` = `RESEND_API_KEY && RESEND_FROM`. Both must be set.
- Resend's integration creates the API key and injects `RESEND_API_KEY`. It does
  **not** set a from-address — `RESEND_FROM` is always separate.
- Default `Knack <onboarding@resend.dev>` only delivers to the **Resend account
  owner's** email until a domain is verified at <https://resend.com/domains>.
- Not configured → `sendEmail()` returns `false`; the admin invite flow
  (`app/(app)/administration/user-actions.ts`) still returns a copyable invite
  link. Password-reset emails simply don't send.

---

## Verify / test

There's no headless way to test the live deploy flow. To verify: click the button
once in a throwaway scope and confirm the integration step shows **Neon** +
**Resend** and the env form asks for only the four values. The `oac_` id and URL
encoding are verified-correct; the only real proof is one click.

---

## Gotchas learned

- **`oac_` is public/global**, not account-specific. Scrape it; don't install.
- **`vercel integration add resend` fails** ("not a Marketplace integration") and
  **`vercel integration discover resend` finds nothing** — because Resend is OAuth,
  not a native resource integration. This is expected, not a bug.
- **`vercel env pull` defaults to the Development environment** and **overwrites
  `.env.local`** — see README "Local development".
- **CLI bug (v54.10.2):** `vercel env add <NAME> preview` loops on
  `git_branch_required` even when given its own recommended non-interactive
  command. Newer CLI (54.15.1+) may fix it; or set preview-env vars in the
  dashboard. Not important for email.
- Resend (OAuth) requests "manage deployments + manage env vars" scopes — that's
  how it writes `RESEND_API_KEY`.

---

## State of the maintainer's own Vercel project (`knack`)

Separate from the button (this is the live instance, account-specific):

- Installed integrations: **Neon, Stripe, Upstash**. **Resend is NOT installed.**
- `RESEND_FROM` is set on **Production + Development** (Preview skipped due to the
  CLI bug above; not needed).
- **To turn on email for this instance:** dashboard → `knack` project →
  Integrations → add **Resend** (one OAuth click). It injects `RESEND_API_KEY`
  and email goes live immediately (`RESEND_FROM` already set). This is the only
  step tied to the personal account — the Deploy Button does the equivalent for
  new installs.

---

## Files involved

- `README.md` — the Deploy Button `<a href>` + the "Deploy" walkthrough.
- `lib/email.ts` — Resend REST client + `emailConfigured()` graceful fallback.
- `app/(app)/administration/user-actions.ts` — invite flow; returns copyable link.
- `.env.example` — documents the env vars (no `RESEND_API_KEY` line needed for
  button installs; it's injected).
- `scripts/migrate.mjs` — runs migrations during `build` (auto-migrate on deploy).
