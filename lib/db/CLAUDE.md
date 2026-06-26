# Data layer (`lib/db/`)

Drizzle ORM + Neon **HTTP** driver. `index.ts` exports `db` as a **lazy Proxy** —
importing never throws at build time; the connection (and the missing-`DATABASE_URL`
error) only resolves on first query. Never import-time-assert env here.

Schema changes: edit `schema.ts` → `pnpm db:generate` (drizzle-kit, writes a
migration + meta snapshot under `migrations/`) → `pnpm db:migrate`. `db:push` is
for first deploy / dev only.

## Tables (`schema.ts`)

**Better Auth (managed by the plugin — don't hand-edit semantics):**
`user` (+ `role`, `banned`, `timezone` — used for date rendering in the prompt),
`session`, `account`, `verification`, `rate_limit`.

**App tables:**
- `chat` — the central row. Carries the chat itself **and** doubles as a kanban
  **card** (see `lib/supervisor/CLAUDE.md`). Columns: `userId`, `title`, `starred`
  (gates the retention sweep), `source`/`sourceRef` (`user`|`cron`|`supervisor`|
  `telegram`; `sourceRef` ties a run to its origin), `model`, **`systemPrompt`**
  (assembled + frozen at creation, reused every turn), `projectId` (set-null on
  project delete), git-sync state (`gitState`/`lastCommitSha`/`lastSyncedAt`,
  written by `gitSync` after each turn), and the kanban/supervisor block:
  `kanbanStatus`, `supervisorEnabled`, `cardSeq` (KNK-`<n>` from the `card_seq`
  sequence), `userStory`/`details`, `acceptanceCriteria`/`tasks`/`testCases`
  (jsonb), `activeRole`, `blockedReason`, `iteration`, `runStartedAt`/`lastRunAt`,
  `supervisorLeaseUntil` (supervisor cycle lock) + `chatLeaseUntil` (interactive
  Telegram turn lock — **two distinct leases**), `maxRoundsOverride`/`maxTokensOverride`.
- `message` — `chatId`, `role`, `parts` (jsonb — text, tool calls, and
  `data-attachment` parts; see `lib/attachments/CLAUDE.md`), `idx`, `createdAt`.
- `usage_event` — per-call token log (input/output) for supervisor budgets, indexed
  `(chatId, createdAt)`.
- `project` — GitHub-backed workspace (`repoOwner`/`repoName`/`defaultBranch`).
  `active` gates cron + the chat selector. `userId` owns it (cron re-derives userId
  from here, never the request body).
- `cron_state` — per-project schedule **cache** (parsed jobs + `etag` + precomputed
  `nextRunAt`/`lastRunAt`). A cache only — GitHub `cron.json` is truth. See
  `lib/cron/CLAUDE.md`.
- `github_account` — per-user PAT (`encryptedPat`, `login`, `githubUserId`, `status`).
- `telegram_account` — per-user bot (`encryptedBotToken`, `webhookSecret`,
  `authorizedTgUserId`, `dmChatId`, `activeChatId`, `lastUpdateId`). See
  `lib/telegram/CLAUDE.md`.
- `api_key` — shared (deployment) BYOK provider keys.
- `global_secret` — deployment-wide secret vault (`encrypted`, `last4`). Cascades
  with the per-user vault: `secret_get` reads the user's value, else the global one.
- `user_secret` — per-user vault (static secrets + OAuth connections; OAuth tokens
  refreshed at read).
- `custom_endpoint` — OpenAI-compatible endpoint config for `compatible` mode.
- `app_settings` — **singleton** (id=`"app"`), admin-managed, shared by all users.
  Holds: `connectionMode`/`defaultModel`/`generalModel`; supervisor budgets
  `maxRounds`/`maxTokensPerCard`; `retentionDays` (0 = keep forever); sandbox
  `sandboxSnapshotId`/`sandboxSnapshotStatus`; voice `assemblyaiKey`(enc)/`...Last4`;
  and SMTP `smtpEnabled`/`smtpHost`/`smtpPort`/`smtpSecure`/`smtpUser`/`smtpPass`(enc)/
  `smtpPassLast4`/`smtpFrom` (see `lib/email.ts`).
- `user_settings` — **deprecated**. Kept only so migrations stay additive; all
  config moved to `app_settings`. Don't add to it.

All encrypted columns are AES-256-GCM `iv:tag:ciphertext` via `lib/crypto.ts`,
decrypted only server-side at point of use.

## Gotchas
- **Migration renames need a TTY** — `drizzle-kit generate` prompts to disambiguate
  renames vs drop+add. 0023 (Telegram + the `lease_until` → `supervisor_lease_until`
  rename) was hand-authored (SQL + snapshot + journal); re-running `generate`
  reports no diff, confirming meta matches `schema.ts`. Do the same for future
  renames or run `generate` interactively.
- `index.ts` reads `DATABASE_URL` lazily — keep it that way.
