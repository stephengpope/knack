# Skills subsystem

Skills are reusable capability packages a project carries in its repo at
`.skills/<name>/SKILL.md` ([agentskills.io](https://agentskills.io) format:
YAML frontmatter `name` + `description`, then a markdown body; optional
`scripts/`, `references/`, `templates/`, `assets/`). Progressive disclosure:
only name + description go in the prompt; the body loads on demand.

**Two skill roots.** Project skills (repo `.skills/`) + **built-in skills**
(`$HOME/.skills/` baked into the sandbox snapshot — 11 of them: `agent-browser` +
10 `firecrawl-*`). Built-ins are read-only and **win on name collision**. See
`lib/sandbox/CLAUDE.md` for how they're vendored/built.

## Files
- `discover.ts` — `scanSkills(pat, project)` reads the repo `.skills/` over the
  **GitHub API at chat creation** (never the sandbox) → `Skill[]`
  (`{name, description}`). **Recursive** (any depth; leaf folder = skill identity,
  keep-first on leaf-name collision). `extractDescription` = frontmatter
  `description` (handles `|`/`>` YAML block scalars), else first real body line.
- `resolve.ts` — **dual-root runtime resolution** over the sandbox box:
  `resolveSkillDir(box, name)` searches `$HOME/.skills` (built-in) then repo
  `.skills`; `enumerateSkills(box)` lists the deduped union. Backs `skill_load` /
  `skills_list` / `skill_manage` so they see built-ins + project skills.
- `render.ts` — `renderSkillsSection(skills)` → the `<available_skills>` block
  injected into the system prompt (`## Skills (mandatory)` + name/description).
- `read.ts` — `skillLoad(box, name, file?)` (read a skill's SKILL.md / a bundled
  file from the sandbox, list its files), `skillsList(box)` (live list from the
  sandbox `.skills/`).
- `manage.ts` — `skillManage(box, args)`: actions create/edit/patch/delete/
  write_file/remove_file. **Validates, then writes to the sandbox working tree.
  No git** — the agent commits via its normal flow. `patch` uses the fuzzy matcher.
  **Refuses to mutate a built-in skill** (resolves the real path first).
- `validate.ts` — name (agentskills.io rule), frontmatter, size, file-path rules.
  Strict on authoring (create/edit must have `name` + non-empty `description`).
- The fuzzy matcher now lives at `lib/files/fuzzy-match.ts` (shared file-edit
  infra). `skill_manage` `patch` imports `fuzzyFindAndReplace`/`formatNoMatchHint`
  from there so the model's `old_string` need not match byte-for-byte. See
  `lib/files/CLAUDE.md`.

## Tools (defined in `lib/agent/run-turn.ts`)
`skill_load`→`skillLoad`, `skill_manage`→`skillManage`, `skills_list`→`skillsList`.
Tool name ↔ same-named function; tools live in run-turn.ts, logic lives here.

## Key behaviors
- **Frozen per chat:** the `<available_skills>` list is baked into the system
  prompt at chat creation (stored on `chat.systemPrompt`). A skill created/edited
  mid-chat appears in the **next** chat — use `skills_list` to see the live set.
- Discovery (GitHub) is lenient (description fallback); authoring (`skill_manage`)
  is strict. Skill content is **trusted** (no security scan).

## Deferred (hermes has these; we don't yet)
hub (install from external sources), plugins, curator (auto-consolidation), usage
telemetry/pinning. (Built-in/bundled skills now exist — vendored into the sandbox
snapshot, see `lib/sandbox/CLAUDE.md`.)
