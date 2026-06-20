# File tools (`lib/files/`)

Sandbox file-operation logic, modeled on hermes' `tools/file_tools.py`. Tool
*definitions* live in `app/api/agent/route.ts`; each delegates to a same-named
function here (same convention as `lib/skills/`). All take a `SandboxBox`
(`lib/sandbox/types.ts`) and use only its existing `readFile`/`writeFile`/`run`
methods — no new box primitives.

## Files
- `read.ts` — `fileRead(box, path, offset?, limit?)`: paginated, line-numbered
  read. Output is `LINE|CONTENT` (compact, no padding — hermes found padding
  costs ~16% more tokens for no accuracy gain). ~100K-char slice cap; per-line
  truncation at 2K; "did you mean?" filename suggestions on not-found.
- `edit.ts` — `fileEdit(box, path, old, new, replaceAll?)`: targeted
  find-and-replace via the fuzzy matcher, then **re-reads to verify** the edit
  landed (catches silent write failures / concurrent clobbers). Returns a
  unified diff. Also exports `unifiedDiff()` (LCS-based, 3 lines context).
- `search.ts` — `searchFiles(box, args)`: one tool, two targets. `content` greps
  inside files; `files` finds files by glob. ripgrep-backed, **falls back to
  grep/find** when `rg` is absent (detected via shell exit 127). `output_mode`
  content|files_only|count; `context`, `file_glob`, `limit`/`offset`.
- `fuzzy-match.ts` — `fuzzyFindAndReplace` (9-strategy chain: exact →
  line-trimmed → … → context-aware) + `findClosestLines` + `formatNoMatchHint`.
  Ported faithfully from hermes' `fuzzy_match.py`. Shared: backs both `file_edit`
  and `skill_manage` `patch` (`lib/skills/manage.ts`).

## Tools (defined in `app/api/agent/route.ts`)
`file_read`→`fileRead`, `file_edit`→`fileEdit`, `search_files`→`searchFiles`.
`file_write`/`files_list` stay inlined (thin wrappers over box methods).

## Design notes
- **No read-before-edit / staleness guard machinery.** Hermes' soft warnings and
  dedup/loop-blockers target its multi-agent model; knack is one box / one agent
  per chat, so they'd rarely fire. The "read before you edit" nudge lives in the
  tool descriptions instead.
- Search is shelled through `bash -c` (with single-quote escaping) so a missing
  `rg` surfaces as exit 127 and the grep/find fallback kicks in transparently.
