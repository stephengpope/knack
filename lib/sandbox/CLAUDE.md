# Sandbox (`lib/sandbox/`)

Provider-agnostic adapter. One box per chat (`name: chat-${chatId}`,
`resume: true`) — the SDK reconnects to a live session or creates fresh, no local
cache, works across function instances. Swap providers = add one adapter.

## Box interface (`types.ts`)
`SandboxBox`: `run(cmd, args?)`, `readFile`, `writeFile` (creates parent dirs),
`listDir`, `stop`. `Sandbox.getOrCreate(...)`. **Only `vercel.ts` may import
`@vercel/sandbox`** — everything else uses these methods, nothing more.

## Snapshot (fast boot)
New boxes boot from a pre-built **snapshot** (~1s) instead of installing tools
inline (30–60s). Built **lazily on first use**, reused by all chats.
- `vercel.ts` — `getOrCreate` → `boxFromSnapshot` (self-heals: a 404 on a
  deleted/expired snapshot triggers rebuild) → falls back to `plainBox`
  (inline install) when no snapshot or build in progress.
- `snapshot-store.ts` — DB persistence of `{sandboxSnapshotId, sandboxSnapshotStatus}`
  on the `app_settings` singleton (can't live in Vercel env — deploy-time
  immutable). **Compare-and-set build lock**: `acquireBuild` claims only when
  status is null/`failed`/stale-`building` (15-min reclaim). Exactly one builder;
  the rest fall back to a plain box.
- `provision.ts` — **source of truth for snapshot contents**: ordered `buildSteps`
  (chromium deps → ripgrep static binary [best-effort `|| true`] → npm globals
  `agent-browser` + `firecrawl-cli` → write built-in skills) and `smokeTests`
  (binary checks + one `test -s` per built-in skill — **abort build if any fail**).
- `builtin-skills.ts` — vendored SKILL.md bodies for the 10 `firecrawl-*` skills
  (the 11th, `agent-browser`, ships in its npm package and is copied at build). No
  network fetch at build — all trusted local sources.

## Built-in skills
11 skills baked into `$HOME/.skills/` in the snapshot (outside the repo,
persistent). They are **read-only** — `skill_manage` refuses to mutate a built-in.
Discovery is dual-root: `lib/skills/resolve.ts` scans both `$HOME/.skills`
(built-in, wins on name collision) and `REPO_DIR/.skills` (project). Metadata is
also injected into the system prompt at chat creation (`BUILTIN_SKILLS` in
`provision.ts` → merged in `lib/prompt/build.ts`). Firecrawl skills need
`FIRECRAWL_API_KEY` — their vendored bodies tell the agent to `secret_get` it first.

## Gotchas
- **`$HOME` must be double-quoted** in build/smoke shell commands — single quotes
  don't expand it, so a `test -s '$HOME/...'` always failed and the snapshot never
  saved (commit b89c6fa). Log build failures; don't swallow them.
- Any non-zero build step aborts the snapshot (except the best-effort ripgrep
  install). Chromium deps must install **before** `agent-browser install`.
- `snapshot({ expiration: 0 })` = never auto-expire; deletion is recovered via the
  404 self-heal.
