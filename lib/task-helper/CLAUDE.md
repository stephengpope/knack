# Task Helper (`lib/task-helper/`)

A small, **stateless** LLM helper that turns a rough brief into a structured kanban
ticket (`TicketDraft`: title, user story, details, acceptance criteria). Used by the
**board** card-creation dialog (`components/board/task-helper-dialog.tsx` →
`app/(app)/board/task-helper-actions.ts`). No persistence, no sandbox, no tools —
just LLM calls. The dialog accumulates the Q&A `rounds` client-side and passes the
whole history each turn.

## One turn = `runTaskHelperTurn(input)` → `TaskHelperResult` (`run.ts`)
Two-pass, to keep generation honest:
1. **Pass 1** (`generateText`, free-form prose) — using `TASK_HELPER_PROMPT`: either
   ask clarifying questions, or, when ready, write the finalized ticket as prose.
2. **Pass 2** (`generateObject`, schema) — using `TASK_HELPER_STRUCTURE_PROMPT`:
   transcribe pass-1 prose into the schema **without inventing** anything.

`done` + `ticketDraft` are mutually exclusive with `questions` — a turn either asks
or finalizes, never both.

## Files
- `types.ts` — client-safe types (`TicketDraft`, `ClarifyRound`, `TaskHelperInput`,
  `TaskHelperResult`).
- `prompt.ts` — the two fixed system prompts + `renderTaskHelperPrompt(input)`
  (assembles brief + Q&A history).
- `run.ts` — `runTaskHelperTurn` (model via `resolveAgentModel`).

The split (prose → transcription) is the same trick the supervisor uses for its
DECIDE phase: don't make one call both reason freely **and** emit valid structure.
