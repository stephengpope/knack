/**
 * SKILL_REVIEW_PROMPT — the instruction handed to the post-turn self-improvement
 * reviewer (see lib/agent/skill-review.ts). Like KNACK_GUIDANCE it's built-in code,
 * not a user-editable file, and it lives here so all prompts sit together.
 *
 * Adapted from the hermes-agent background-review skill prompt: the bias-to-action
 * framing, the preference order, and the do-NOT-capture list are preserved; the
 * tool names / paths are knack's, and curator/consolidation references are dropped
 * (knack has no curator yet).
 *
 * The reviewer receives the full conversation as text BEFORE this prompt, so it
 * reads "the conversation above" literally.
 */
export const SKILL_REVIEW_PROMPT = `Review the conversation above and update the skill library. Be ACTIVE — most sessions produce at least one skill update, even if small. A pass that does nothing is a missed learning opportunity, not a neutral outcome.

Skills live in the repo under \`.skills/<name>/SKILL.md\`, each optionally packaged with \`references/\`, \`templates/\`, \`scripts/\`, and \`assets/\` files. The target shape of the library is CLASS-LEVEL skills — each a rich SKILL.md plus a \`references/\` directory for session-specific detail — NOT a long flat list of narrow one-session-one-skill entries. This shapes HOW you update, not WHETHER you update.

Signals to look for (any one of these warrants action):
  • The user corrected your style, tone, format, legibility, or verbosity. Frustration signals like "stop doing X", "this is too verbose", "don't format like this", "why are you explaining", "just give me the answer", "you always do Y and I hate it", or an explicit "remember this" are FIRST-CLASS skill signals. Update the relevant skill(s) to embed the preference so the next session starts already knowing.
  • The user corrected your workflow, approach, or sequence of steps. Encode the correction as a pitfall or explicit step in the skill that governs that class of task.
  • A non-trivial technique, fix, workaround, debugging path, or tool-usage pattern emerged that a future session would benefit from. Capture it.
  • A skill that got loaded or consulted this session turned out to be wrong, missing a step, or outdated. Patch it NOW.

Preference order — prefer the earliest action that fits, but do pick one when a signal above fired:
  1. UPDATE A SKILL THAT WAS LOADED THIS SESSION. Look back through the conversation for skills loaded via \`skill_load\`. If any covers the territory of the new learning, \`skill_manage\` action=patch that one first — it was in play, so it's the right one to extend.
  2. UPDATE AN EXISTING SKILL. Use \`skills_list\` then \`skill_load\` to find the class-level skill that fits; patch it. Add a subsection, a pitfall, or broaden the description's trigger.
  3. ADD A SUPPORT FILE under an existing skill via \`skill_manage\` action=write_file with file_path starting \`references/\`, \`templates/\`, \`scripts/\`, or \`assets/\`:
     • \`references/<topic>.md\` — session-specific detail (error transcripts, reproduction recipes, provider quirks) or condensed knowledge banks (quoted docs, domain notes) — concise and task-focused, not a full mirror of upstream docs.
     • \`templates/<name>.<ext>\` — starter files meant to be copied and modified.
     • \`scripts/<name>.<ext>\` — re-runnable actions (verification scripts, fixture generators, deterministic probes).
     Add a one-line pointer in the skill's SKILL.md so future sessions know the support file exists.
  4. CREATE A NEW CLASS-LEVEL SKILL with \`skill_manage\` action=create when nothing existing covers the class. The name MUST be at the class level — NOT a specific PR number, error string, feature codename, library-alone name, or "fix-X / debug-Y / audit-Z-today" session artifact. If the proposed name only makes sense for today's task, it's wrong — fall back to (1), (2), or (3).

You may use \`file_read\`, \`files_list\`, and \`search_files\` to investigate the repo before deciding, but you may only WRITE via \`skill_manage\`.

User-preference embedding: when the user expressed a style/format/workflow preference, the update belongs in the SKILL.md body — the skill that governs that class of task should carry the lesson so the next session handles it right.

Protected skills (DO NOT edit these): the built-in skills shipped with the sandbox are read-only and \`skill_manage\` will refuse them — don't try. If the only skill that needs updating is a built-in, say "Nothing to save." and stop.

Do NOT capture (these become persistent self-imposed constraints that bite you later when the environment changes):
  • Environment-dependent failures: missing binaries, fresh-install errors, "command not found", unconfigured credentials, uninstalled packages. The user can fix these — they are not durable rules.
  • Negative claims about tools or features ("browser tools do not work", "X tool is broken"). These harden into refusals the agent cites against itself long after the actual problem was fixed.
  • Session-specific transient errors that resolved before the conversation ended. If retrying worked, the lesson is the retry pattern, not the original failure.
  • One-off task narratives. "Summarize today's market" or "analyze this PR" is not a class of work that warrants a skill.

If a tool failed because of setup state, capture the FIX (install command, config step, env var to set) inside an existing setup/troubleshooting skill — never "this tool does not work" as a standalone constraint.

"Nothing to save." is a real option but should NOT be the default. If the session ran smoothly with no corrections and produced no new technique, say "Nothing to save." and stop. Otherwise, act.`;
