# Plan: Chat & Telegram Attachments

Status: design complete, verified end-to-end (except live inference, blocked by gateway credits).
Branch: `feat/chat-attachments`.

## Goal

Let users attach files (images, PDFs, text/code, zips, arbitrary binaries) to a
message in the web chat and via Telegram. Each attachment serves two purposes:
1. **Model context** — images/PDFs the model can see; text files whose contents are
   read into the prompt.
2. **Sandbox material** — the raw file lands in `REPO_DIR/.attachments/` so the coding
   agent can operate on it (e.g. unzip, parse). `.attachments/` is **git-ignored**, so
   attachments never get committed.

## Verified facts (live tests on real Vercel Blob + a real sandbox)

- Private Blob store: unsigned GET → **403**; presigned GET → 200, bytes match; a second
  URL signed from the **cached** delegation token works with no extra network call.
- Presigned **PUT** (client-direct upload) works; CDN enforces content-type (wrong → 400).
- Server-side `get()` read returns exact bytes (the model/sandbox read path).
- Binary **zip → sandbox `.attachments/`**: Buffer write → md5 identical → `unzip` valid.
- Per-chat **prefix `list()` + bulk `del()`** removes a chat's blobs, others untouched; `del` is free.
- `prepareForModel` transform: image kept, csv→fenced text, zip→note; **no unsupported part reaches the model**.
- From source: data-URL → Anthropic base64 with **no network fetch**; full provider matrix (below).
- Live inference: a gateway test returned **402 insufficient_funds**, but **this deployment uses
  `custom` mode (direct Anthropic), not the gateway** — so that path is unused. Direct-Anthropic
  vision/PDF is testable with the deployment's own Anthropic key (a few cents); not yet run.

## Architecture (FINAL — locked)

### Storage: private Blob + signed URLs, type-aware retention

- All uploads go **client-direct to a private Blob store** via presigned PUT
  (`uploadPresigned` + a `handleUploadPresigned` route). This bypasses the Vercel
  function body limit entirely (the 4.5 MB cap never applies — bytes never traverse a function).
  Blobs keyed `chat/{chatId}/{uuid}-{filename}`.
- **Renderable attachments (image/*, application/pdf): kept durable in Blob.** Rendered in
  the browser via short-lived **signed GET URLs** (1 h delegation token, cached server-side,
  per-URL signed locally). Re-inlined to the model each turn by server-reading the bytes.
  Message stores only `{pathname, filename, mediaType, size}` — never bytes, never a URL.
- **Non-renderable (text/code, zip, binary): blob is transient.** Server reads bytes →
  writes to sandbox `.attachments/` → **deletes the blob**. Text file contents are extracted
  into a fenced text part (model sees them); zips/binaries become a one-line note. Message
  stores the text/note — no bytes.
- **Every** attachment is written into the sandbox `.attachments/` at turn time, so the agent
  can operate on any of them (images included). The durable copy for renderables is Blob; the
  sandbox copy is ephemeral (1-day box TTL).

### Retention (bounds cost; starred-exempt)

- New `app_settings.retentionDays`, set on the Administration settings page. **Default 7 days**
  (`0` = disabled / keep forever).
- The single Vercel cron drives our daily tick, which (alongside project crons and supervisor
  cycles) runs a global retention sweep: **all unstarred** chats whose **last-updated** timestamp
  is older than the window — `starred = false AND updatedAt < now - retentionDays` — are deleted.
  Semantics: `updatedAt` (last *used*, bumped every turn), **not** `createdAt`, so any chat touched
  within the window survives. Scope is **all** unstarred chats regardless of source
  (chat/telegram/cron/supervisor). It deletes every eligible chat per run (not throttled).
- Per deleted chat: `list({prefix:'chat/{id}/'}) + del()` its blobs → `deleteChat`. DB cascades
  handle `message`/`usage_event`; the box auto-expires.
- Signed-URL rendering means there is **no permanent public URL**; private throughout.

### Provider-aware model handling (graceful, never crash or silently drop)

`prepareForModel(parts, providerCaps)` builds the model-facing message:
- **text-like** (text/*, json, csv, md, code) → always a fenced text part (universal).
- **image / pdf / audio** → inline **only if the active provider supports it**, else a note
  (`[image attached: x.png — current model can't view it; saved to .attachments/]`).
- **everything else** → note.
- Backstop: wrap the turn; on `UnsupportedFunctionalityError`, demote the offending part to a
  note and retry once.

Provider capability matrix (from installed `@ai-sdk/*` source):

| Provider | image/* | pdf | audio | text inline | unsupported → |
|---|---|---|---|---|---|
| anthropic | ✓ | ✓ | — | text/plain | throws |
| openai | ✓ | ✓ | wav/mp3 | — | throws |
| openai-compatible | ✓ | ✓ | wav/mp3 | text/* | throws |
| mistral | ✓ | ✓ | — | — | throws |
| google | ✓ | — | — | — | **silently skips** |
| xai | ✓ | — | — | — | throws |
| deepseek | — | — | — | — | **silently skips** |
| gateway | passthrough → underlying provider validates |

The map is keyed by provider prefix (works for gateway-passthrough, custom, compatible) and is
**read from the live `app_settings.connection_mode` + model provider at runtime** — not assumed.
(This deployment runs `custom` → **Anthropic**: image + pdf + text/plain supported.)
The two **silent-skip** providers (google, deepseek) are the reason the map is mandatory:
without it, an image would vanish with no error. Audio is treated as a sandbox note in v1
(not inlined) to avoid per-provider audio handling.

## Component changes (file:line integration points)

### 1. Sandbox adapter — binary write
- `lib/sandbox/types.ts:10` — widen `writeFile(path, content: string)` → `string | Buffer | Uint8Array`.
- `lib/sandbox/vercel.ts:47` — same; the underlying `sb.fs.writeFile` already accepts Buffer (verified).
- (No readFile change needed — we only write binary in.)

### 2. Blob upload route + helpers (new)
- `app/api/attachments/upload/route.ts` — `handleUploadPresigned`; `getSignedToken` **must
  authenticate the user and scope the pathname to a chat they own** (else anonymous uploads).
  Token scoped `operations:['put']`, `allowedContentTypes`. **No artificial size cap** — client-direct
  upload bypasses the 4.5 MB function limit, Blob goes to 5 TB, and the sandbox handles large files;
  the only real limits are Telegram's own 20 MB and per-provider per-image inline limits (the latter
  handled by degrading an oversized image to a note at inline time, not by blocking upload).
- `lib/attachments/blob.ts` (new) — `signGetUrls(pathnames)` (cached 1 h delegation token,
  local per-URL signing), `readBlob(pathname)` (server get → Buffer), `deleteChatBlobs(chatId)`
  (`list`+`del` by prefix), `putServerSide(...)` for the Telegram path.
- Env: `BLOB_READ_WRITE_TOKEN` (auto from store) + `BLOB_WEBHOOK_PUBLIC_KEY` (for the
  `onUploadCompleted` callback verification).

### 3. Composer (web)
- `components/ai-elements/prompt-input.tsx` — attachment UI **already built** (file picker,
  drag/drop, paste, chips, remove). Wire `PromptInputActionAddAttachments` into the footer.
- `components/chat/chat.tsx:334` `submit()` — stop dropping files: on submit, `uploadPresigned`
  each file → build the message `parts` with attachment metadata (image/pdf → file-ref part;
  others → metadata for server processing) → send. Optimistic local object-URL preview until persisted.
- `components/chat/chat.tsx:~529` user-message render — render attachment parts: image thumbnail
  (signed URL), file chip with name/size; **use plain `<img>`, not `next/image`** (private blobs).
- Enforce a sane per-message attachment count in the composer; surface upload failures gracefully
  (no size cap — see upload route).

### 4. Agent turn
- `app/api/agent/route.ts:13` — body already carries the full `UIMessage`; no shape change.
- `lib/agent/run-turn.ts:176` — after load/append/save, **materialize attachments**: for each
  new attachment, `readBlob` → write to `.attachments/` (ensure `.attachments/.gitignore` exists
  first, idempotent); keep renderable blobs, delete transient ones.
- `lib/agent/run-turn.ts:~602/619` — feed `createAgentUIStream` a `prepareForModel`-transformed
  copy of the messages; keep the stored/display messages as the chip version
  (`originalMessages` stays the un-transformed set). Provider caps via `lib/llm.ts` provider detection.
- Wrap the agent call with the demote-on-`UnsupportedFunctionalityError` backstop.

### 5. Message rendering on load (signed URLs)
- Where the chat page/messages are loaded server-side (`lib/chats.ts:180` `loadMessages` or the
  page loader), sign GET URLs for renderable attachments before handing messages to the client.
  Fresh URLs each load; `clientSigningToken` never leaves the server.

### 6. Telegram
- `lib/telegram/api.ts:12` `TgMessage` — add `photo[]` and `document` fields. `downloadFile`
  (`:125`) already returns `ArrayBuffer`.
- `app/api/telegram/[userId]/webhook/route.ts:~80` — branch on `msg.photo`/`msg.document`
  (model on the existing voice branch): check `file_size` first; if > 20 MB (Telegram cap) reply
  gracefully without downloading. Else download → `putServerSide` to Blob (renderable) or
  sandbox+note (non-renderable) → build the same `UIMessage` parts → `runAgentTurn`.
- Outbound (agent → user files) is **out of scope** (deferred, per decision).

### 7. `.attachments/` template + git
- `lib/prompt/defaults/` — add `.attachments/.gitignore` containing `*\n!.gitignore` (self-ignoring;
  **no `.gitkeep`**). Wire into `lib/prompt/files.ts` template list + `lib/projects.ts:135` seeding.
- Idempotent guard in the materialize step ensures `.attachments/.gitignore` exists for
  pre-existing projects (so `git add -A` never commits an attachment). `lib/git/sync.ts:75`
  `git add -A` respects `.gitignore` (verified).

### 8. Retention cron + settings
- `lib/db/schema.ts:259` — add `retentionDays: integer().default(7).notNull()` to `app_settings`;
  generate + run migration.
- `lib/settings.ts` — add `retentionDays` to the Settings type + getter/setter (maxRounds pattern).
- `app/api/cron/tick/route.ts` — after the existing phases, call `sweepExpiredChats(now, retentionDays)`
  (skip when `retentionDays === 0`). New `lib/retention/sweep.ts` (global, not user-scoped; matches
  on `updatedAt`, all unstarred chats).
- Admin UI — add a "Retention" field/section in `components/administration/administration-view.tsx`
  + a `setRetentionDaysAction` in `app/(app)/administration/actions.ts`.

### 9. Deploy button + README
- Add a **private** Blob store to the deploy-button `stores` array (auto-provisions
  `BLOB_READ_WRITE_TOKEN`); add `BLOB_WEBHOOK_PUBLIC_KEY` to the env list.
- README: env table (+ `BLOB_READ_WRITE_TOKEN`, `BLOB_WEBHOOK_PUBLIC_KEY`), cost table (Blob free
  tier + retention note), feature blurb.

## Errors / omissions / STALE-decision sweep

**Stale ideas from earlier in design — DO NOT implement (superseded):**
- ❌ "Delete every blob immediately" → only **text/zip/binary** blobs are deleted; image/PDF blobs are durable (retention-governed).
- ❌ "Store image bytes as data URLs in Postgres" → images live in **Blob**; Postgres holds only references. (Avoids DB bloat.)
- ❌ "Auth-proxy route to render private blobs" → **signed URLs** (proxy rejected as the hacky path).
- ❌ "Public blobs" → **private** store throughout.
- ❌ "Raw multipart upload route through the function / one-file-per-request to beat 4.5 MB" → **client-direct presigned upload** bypasses the function; the 4.5 MB limit is irrelevant to uploads.
- ❌ "`.gitkeep`" → a self-ignoring `.attachments/.gitignore` does both jobs.
- ❌ "A vs B retention" framing → settled as retention-window + starred-exempt.
- ❌ "~3.3 / 4.4 MB caps as the governing limit" → not applicable to client-direct upload; the real caps are a configurable max (token `maximumSizeInBytes`), Telegram's 20 MB, and per-provider model limits.

**Omissions now folded in:**
- `BLOB_WEBHOOK_PUBLIC_KEY` required for `handleUploadPresigned`.
- Upload route MUST auth the user and scope pathname to their chat (no anonymous/cross-chat writes).
- Signed GET URLs are minted **server-side** at load; the secret signing token never reaches the client.
- Model never receives a signed URL (they expire) — server reads bytes + inlines each turn (re-sent every turn = a token-cost note for image-heavy chats).
- `next/image` does not work with private blobs → plain `<img>`.
- Telegram bytes are already server-side → use `put()` directly, **not** the presigned client flow.
- Retention default **7 days** (on); sweep is **global** (the existing `deleteChat` is user-scoped, so
  the sweep deletes system-side).

## Decisions (resolved)

1. **Retention sweep**: runs once per day on our tick; deletes **all** eligible chats per run (not throttled).
2. **Retention scope**: **all unstarred chats**, any source; matched on **`updatedAt`** (last used), not `createdAt`.
3. **Images in sandbox**: yes — **every** attachment is written to `.attachments/`.
4. **Upload cap**: **none** — no artificial size cap (see upload route rationale).

## Out of scope (v1)
- Outbound attachments (agent → user files via Telegram `sendDocument`/web download).
- Audio inlined to the model (kept as sandbox note).
- PDF text-extraction fallback for no-PDF providers (kept as note; agent can parse from `.attachments/`).
