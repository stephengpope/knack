# Telegram integration (`lib/telegram/`, `app/api/telegram/`, Settings → Telegram tab)

Per-user Telegram bot front-end to the **same** `runAgentTurn`. One bot + one
authorized human per user. DM-only (no groups/forum topics). Telegram is just
another caller of the agent loop — no new agent infra.

## Data
- **`telegram_account`** (`lib/db/schema.ts`, one row per user): `encryptedBotToken`
  + `webhookSecret` (both AES-GCM via `lib/crypto`), `authorizedTgUserId` (gates
  inbound), `dmChatId` (== the user's id in a private chat; where outbound goes),
  `activeChatId` (→ the knack `chat` this conversation currently drives), and
  `lastUpdateId` (webhook dedup high-water).
- Telegram chats are ordinary `chat` rows with `source='telegram'`,
  `sourceRef='<dmChatId>'`. They show in the web sidebar like any chat.
- **Two separate lease columns on `chat`** (don't conflate — a Telegram chat can
  also become a supervised card): `chatLeaseUntil` = interactive turn lock (this
  feature, `lib/telegram/lock.ts`); `supervisorLeaseUntil` = supervisor cycle lock.

## Flow (`app/api/telegram/[userId]/webhook/route.ts`)
Public route (under `/api`, so `middleware.ts` auth doesn't apply). Gated instead
by: constant-time `X-Telegram-Bot-Api-Secret-Token` check → `from.id ===
authorizedTgUserId` → `markUpdateSeen` dedup. Returns **200 immediately**, then
`after()`:
1. Re-read account (fresh `activeChatId`). Resolve text — voice/audio →
   `lib/voice/transcribe.ts` (AssemblyAI, reuses app `getAssemblyaiKey()`).
   Documents/photos → `putAttachment` (private Blob) as `data-attachment` parts on
   the message before the turn (see `lib/attachments/CLAUDE.md`).
2. Slash command? → `lib/telegram/commands.ts` (no turn). Else ensure a session
   (create a bare `chat` on the default project if `activeChatId` is null).
3. `claimChatTurn(chatId)` CAS. Busy → reply **"Busy with your last request ⌛"**
   under the message, drop. Else `runAgentTurn` → `streamTurnToTelegram` →
   `result.sync()` → `releaseChatTurn`.

## Streaming (`lib/telegram/stream.ts`)
The Telegram analogue of `drainStream`: it MUST read the UI-message stream to
completion (so the stream's onFinish persists messages). Renders each text
**segment** (text between tool calls) as its own message, edited in place every
**1.3s**; one minimal line per tool call between segments (order preserved — the
answer lands after the tools). `lib/telegram/api.ts` `splitMessage` chunks >4096
(JS `.length` == Telegram's UTF-16 limit; fence-carry; `(n/m)`). 429 → wait
`retry_after + 0.2s` (single retry in `TelegramClient.call`).

## Outbound (`send_message` tool)
Defined in `lib/agent/run-turn.ts`, delegates to `lib/messaging/send.ts`
(platform dispatcher; `telegram` case → send to `dmChatId`). Available in every
turn (web/cron/supervisor/telegram); returns an error if no account is connected.
NOT in `READONLY_TOOLS`, so plan-mode supervisor turns can't message users.

## Setup (Settings → **Telegram tab**)
UI is `components/settings/telegram-tab.tsx` (a tab inside `/settings`, **not** its
own page — it was moved out of the sidebar). Server actions in
`app/(app)/telegram/actions.ts`. Paste bot token + numeric user id (help:
@userinfobot). `connectTelegramAction`: `getMe` (validate) → `setWebhook(secret_token)`
→ `setMyCommands(BOT_COMMANDS)` → store row. Webhook URL = `BETTER_AUTH_URL` +
`/api/telegram/<userId>/webhook`.

## Gotchas
- **Plain text only** — messages are sent with no `parse_mode` (MarkdownV2 needs
  escaping ~18 chars or it 400s). Don't put `*`/`_` markup in bot replies.
- **`BETTER_AUTH_URL` must be public https** for `setWebhook`. Local dev needs a
  tunnel (ngrok) — localhost is unreachable by Telegram.
- **Serverless ⇒ DB locks, not memory.** Hermes' in-process `asyncio.Event` lock
  doesn't port; the per-chat lock lives in `chatLeaseUntil` (CAS). A second
  message while busy is dropped (with ⌛), not queued.
- **Dedup is belt-and-suspenders** — we 200 immediately so Telegram rarely
  retries; `lastUpdateId` high-water guards the after-completion duplicate.
- **Migration renames need a TTY** (`drizzle-kit generate` prompts). 0023 was
  hand-authored (SQL + snapshot + journal); `generate` reports no diff, confirming
  meta matches `schema.ts`. Do the same for future renames, or run generate
  interactively.
