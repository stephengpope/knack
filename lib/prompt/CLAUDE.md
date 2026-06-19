# System-prompt assembly

`build.ts` `buildInstructions(project, pat, skills)` assembles the agent's system
prompt in a **fixed, documented order** (the boxed comment in build.ts is the
source of truth):

```
1. SOUL.md          identity / persona            — from repo
2. KNACK_GUIDANCE   how Knack works (built-in)     — code (knack-guidance.ts)
3. <available_skills>  project's skills            — passed in (lib/skills/render)
4. AGENT.md         project playbook / rules       — from repo
5. MEMORY.md        durable learned facts          — from repo
6. USER.md          the person                     — from repo
```

Repo files (SOUL/AGENT/MEMORY/USER) are fetched **raw** from GitHub and joined
with blank lines — **no wrapper tags** (each file has its own `#` header).

## Frozen per chat
The whole prompt is built **once at chat creation** and stored on
`chat.systemPrompt` (see `app/api/agent/route.ts`); every later turn reuses that
string — no re-fetch, no rescan. Editing SOUL/AGENT/MEMORY/USER, or the agent's
own MEMORY writes, only take effect in the **next** chat (intended).

## Files
- `knack-guidance.ts` — `knackGuidance(project)`: built-in operational guidance
  (sandbox env, working-in-repo, skills how/when). It's **code, not a file**, and
  interpolates project context. It does **not** list the tools — tool schemas
  reach the model via the AI SDK's tool-calling API, not the prompt.
- `paths.ts` — `REPO_DIR` (`/vercel/sandbox`, repo checkout root) and `SKILLS_DIR`
  (`.skills`). Shared by prompt + skills + route code.
- `files.ts` — `TEMPLATE_FILES` + `readTemplate()`: seed a new repo from
  `defaults/DEFAULT_*.md`. Bundled at runtime (see `next.config.ts`
  `outputFileTracingIncludes`).
- `defaults/DEFAULT_*.md` — seed sources written into a new project repo as
  `SOUL/MEMORY/USER/AGENT.md`. `DEFAULT_SOUL` = identity/voice only (tool rules
  live in KNACK_GUIDANCE); `DEFAULT_AGENT` = plain playbook.

## Generating a sample
`sample_system.md` (repo root) is a rendered sample of the assembled prompt with
`#### DEBUG` section markers — regenerate it from the real code when prompt
structure changes.
