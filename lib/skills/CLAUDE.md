# Skills subsystem

Skills are reusable capability packages a project carries in its repo at
`.skills/<name>/SKILL.md` ([agentskills.io](https://agentskills.io) format:
YAML frontmatter `name` + `description`, then a markdown body; optional
`scripts/`, `references/`, `templates/`, `assets/`). Progressive disclosure:
only name + description go in the prompt; the body loads on demand.

## Files
- `discover.ts` — `scanSkills(pat, project)` reads `.skills/` from the repo over
  the **GitHub API at chat creation** (never the sandbox) → `Skill[]`
  (`{name, description}`). `extractDescription` = frontmatter `description`, or
  the first real body line as a fallback.
- `render.ts` — `renderSkillsSection(skills)` → the `<available_skills>` block
  injected into the system prompt (`## Skills (mandatory)` + name/description).
- `read.ts` — `skillLoad(box, name, file?)` (read a skill's SKILL.md / a bundled
  file from the sandbox, list its files), `skillsList(box)` (live list from the
  sandbox `.skills/`).
- `manage.ts` — `skillManage(box, args)`: actions create/edit/patch/delete/
  write_file/remove_file. **Validates, then writes to the sandbox working tree.
  No git** — the agent commits via its normal flow. `patch` uses the fuzzy matcher.
- `validate.ts` — name (agentskills.io rule), frontmatter, size, file-path rules.
  Strict on authoring (create/edit must have `name` + non-empty `description`).
- `fuzzy-match.ts` — `fuzzyFindAndReplace`: 9-strategy fuzzy find-and-replace
  (exact → line-trimmed → … → context-aware) ported faithfully from hermes; backs
  `skill_manage` `patch` so the model's `old_string` need not match byte-for-byte.

## Tools (defined in `app/api/agent/route.ts`)
`skill_load`→`skillLoad`, `skill_manage`→`skillManage`, `skills_list`→`skillsList`.
Tool name ↔ same-named function; tools live in route.ts, logic lives here.

## Key behaviors
- **Frozen per chat:** the `<available_skills>` list is baked into the system
  prompt at chat creation (stored on `chat.systemPrompt`). A skill created/edited
  mid-chat appears in the **next** chat — use `skills_list` to see the live set.
- Discovery (GitHub) is lenient (description fallback); authoring (`skill_manage`)
  is strict. Skill content is **trusted** (no security scan).

## Deferred (hermes has these; we don't yet)
hub (install from external sources), plugins, curator (auto-consolidation), usage
telemetry/pinning, bundled-skill sync.
