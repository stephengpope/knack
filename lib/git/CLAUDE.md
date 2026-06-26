# Git sync (`lib/git/`)

After every agent turn, the chat's sandbox repo is committed and pushed to the
project's default branch. `runAgentTurn` returns a `sync` closure; the route runs
it in `after()` (post-response). Sandbox work is otherwise lost when the box
auto-stops (~5 min idle), so this is what makes a turn durable.

## `sync.ts` — `gitSync(box, branch)` → `GitSyncResult`
Pure code on the happy path; hands anything weird to the LLM fixer. **Always
resolves (never throws)** with the repo's final state (`clean` = committed+pushed,
`dirty` = otherwise). Steps:
1. Anything to do? (dirty tree **or** local commits not yet pushed) — else `clean`.
2. Stage; build a commit message (LLM via `resolveGeneralModel`, with a fallback);
   commit (write to `/tmp/knack_commit_msg`, **outside `REPO_DIR`** so the message
   file never dirties status).
3. Fetch; `git merge --no-edit` if the remote moved.
4. Push, with **one mechanical retry** on non-fast-forward (transport retry).
5. Any commit/merge/push failure → hand to `gitFix`; then `finalize` records state.

## `fix.ts` — `gitFix(box, branch)` → boolean
A **bounded LLM tool-loop** for recovery (merge conflicts, shallow-clone unshallow,
abort/retry, unrecognized git errors). One `run_git` tool, `stopWhen:
stepCountIs(12)` (the seatbelt). Returns `true` only after an **independent
post-verification** (re-checks `git status`, conflict markers, ahead-count) — it
**never trusts the model's word** that the repo is clean.

## Gotchas
- `gitSync` must not throw — callers in `after()` have no one to catch it; a thrown
  error would silently drop the sync. Return `dirty` instead.
- The fixer is bounded by step count, not time. If it can't finish in 12 steps the
  chat stays `dirty` (work survives in the box until it stops) rather than looping.
