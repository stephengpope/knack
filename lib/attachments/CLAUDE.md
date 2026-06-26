# Attachments (`lib/attachments/`)

File attachments for the agent — uploaded in the **chat UI** or received over
**Telegram** (documents/photos). Bytes live in a **private Vercel Blob** store;
the durable record is a `data-attachment` part on `message.parts` (Postgres).
The model never sees the raw part — it gets a provider-safe rewrite.

## Lifecycle (4 stages, distinct code paths)
1. **Upload** → `blob.ts` `putAttachment(chatId, filename, mediaType, buffer)`
   writes to Blob at `chat/<chatId>/<uuid>-<safeName>` and returns an
   `AttachmentRef`. Chat UI hits `app/api/attachments/upload/route.ts`; Telegram
   downloads the file and calls `putAttachment` directly in the webhook.
2. **Materialize** (per turn, `materialize.ts` `materializeAttachments(box, message)`)
   — pulls the new message's blobs into the sandbox `.attachments/` folder so
   `bash_run`/file tools can use them, **inlines text-file content into
   `part.textContent`** (kept in Postgres), then deletes the now-redundant
   transient blobs. Returns `true` if it mutated the part (caller re-saves).
   Best-effort: a turn proceeds even if it throws. Called in `run-turn.ts` only
   when `messageHasAttachments(message)`.
3. **Prepare for model** (`model.ts` `prepareForModel(messages, caps)`) — rewrites
   attachment parts into what the active provider accepts: images/PDFs inlined as
   base64 file parts **only where supported**, text as fenced blocks, everything
   else as a short note. The stored/displayed messages keep the original parts
   untouched. `inlineCapsFor(connectionMode, modelId)` resolves the per-provider
   `{image, pdf}` capability matrix (anthropic/openai/compatible/mistral = both;
   google/xai = image only; deepseek = neither; unknown = image only, conservative).
4. **Render** (`sign.ts` `signMessageAttachments(messages)`) — injects **transient**
   signed GET `url`s into renderable (image/pdf) parts at page load
   (`chat/[chatId]/page.tsx`). The `url` is **never persisted** — only `pathname`
   is durable.

## Files
- `blob.ts` — Blob I/O: `putAttachment`, `readAttachment(pathname)`,
  `signGetUrls(pathnames)`, `deleteAttachment`, `deleteChatBlobs(chatId)` (called
  by the retention sweep — see `lib/cron/CLAUDE.md`).
- `materialize.ts` — `materializeAttachments`, `messageHasAttachments`,
  `anyAttachments`.
- `model.ts` — `prepareForModel`, `inlineCapsFor`, `isUnsupportedMediaError`
  (demote-to-note signal on a provider 4xx).
- `sign.ts` — `signMessageAttachments`.
- `types.ts` — `AttachmentKind` (`image|pdf|text|binary`), `AttachmentData`,
  `AttachmentPart` (`type: "data-attachment"`; `pathname`/`filename`/`mediaType`/
  `size`/`kind`, optional `textContent`, transient `url`), `classifyKind`.

## Gotchas
- **Durable vs transient blob.** Image/PDF blobs stay in Blob (rendered via signed
  URLs); text/binary blobs are deleted after materialize (text lives in
  `textContent`, binary bytes live in the sandbox). Don't assume `pathname` is
  still in Blob for non-renderables.
- **`url` is never stored.** It's minted at render time and at load only. Persisting
  it would bake in an expiring signature.
- Attachments are **message parts, not tools** — there's no vision/image tool. The
  model sees them inline via `prepareForModel`.
