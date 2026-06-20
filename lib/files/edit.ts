import "server-only";
import type { SandboxBox } from "@/lib/sandbox/types";
import { fuzzyFindAndReplace, formatNoMatchHint } from "@/lib/files/fuzzy-match";

// Mirrors hermes' `patch` replace mode: fuzzy find-and-replace (exact first,
// then the 9-strategy chain in fuzzy-match.ts), then re-read to verify the edit
// actually landed on disk before reporting success.

export type EditResult =
  | { ok: true; path: string; replacements: number; strategy: string | null; diff: string }
  | { ok: false; error: string };

export async function fileEdit(
  box: SandboxBox,
  path: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): Promise<EditResult> {
  let current: string;
  try {
    current = await box.readFile(path);
  } catch {
    return {
      ok: false,
      error: `File not found: ${path}. Read it first, or use file_write to create a new file.`,
    };
  }

  const result = fuzzyFindAndReplace(current, oldString, newString, replaceAll);
  if (result.error) {
    const hint = formatNoMatchHint(result.error, result.count, oldString, current);
    return { ok: false, error: result.error + hint };
  }

  await box.writeFile(path, result.content);

  // Post-write verification: re-read and compare. Catches silent write failures
  // and concurrent clobbers that an optimistic write would miss.
  let after: string;
  try {
    after = await box.readFile(path);
  } catch (e) {
    return {
      ok: false,
      error: `Wrote ${path} but could not re-read to verify: ${(e as Error).message}`,
    };
  }
  if (after !== result.content) {
    return {
      ok: false,
      error:
        `Post-write verification failed for ${path}: on-disk content does not ` +
        `match the intended edit (possible concurrent write or write failure). ` +
        `Re-read the file and retry.`,
    };
  }

  return {
    ok: true,
    path,
    replacements: result.count,
    strategy: result.strategy,
    diff: unifiedDiff(path, current, result.content),
  };
}

/** Line-level unified diff (LCS-based) with 3 lines of context per hunk. */
export function unifiedDiff(path: string, a: string, b: string): string {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const ops = lcsDiff(aLines, bLines);

  const CTX = 3;
  type Hunk = { aStart: number; bStart: number; lines: string[] };
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  let trailingCtx = 0;
  let ai = 0;
  let bi = 0;

  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    const isChange = op.type !== "ctx";

    if (isChange) {
      if (!cur) {
        // open a hunk, backfilling up to CTX preceding context lines
        const back = [];
        let j = k - 1;
        while (j >= 0 && ops[j].type === "ctx" && back.length < CTX) {
          back.unshift(ops[j]);
          j--;
        }
        cur = {
          aStart: (back[0]?.aIndex ?? ai) + 1,
          bStart: (back[0]?.bIndex ?? bi) + 1,
          lines: back.map((o) => ` ${aLines[o.aIndex!]}`),
        };
      }
      trailingCtx = 0;
      cur.lines.push(op.type === "del" ? `-${aLines[op.aIndex!]}` : `+${bLines[op.bIndex!]}`);
    } else if (cur) {
      cur.lines.push(` ${aLines[op.aIndex!]}`);
      trailingCtx++;
      if (trailingCtx >= CTX) {
        // close hunk, dropping any context beyond CTX
        cur.lines = cur.lines.slice(0, cur.lines.length - (trailingCtx - CTX));
        hunks.push(cur);
        cur = null;
        trailingCtx = 0;
      }
    }

    if (op.type !== "add") ai = (op.aIndex ?? ai) + 1;
    if (op.type !== "del") bi = (op.bIndex ?? bi) + 1;
  }
  if (cur) {
    if (trailingCtx > CTX) cur.lines = cur.lines.slice(0, cur.lines.length - (trailingCtx - CTX));
    hunks.push(cur);
  }

  if (hunks.length === 0) return "";

  const out = [`--- a/${path}`, `+++ b/${path}`];
  for (const h of hunks) {
    const aCount = h.lines.filter((l) => l.startsWith(" ") || l.startsWith("-")).length;
    const bCount = h.lines.filter((l) => l.startsWith(" ") || l.startsWith("+")).length;
    out.push(`@@ -${h.aStart},${aCount} +${h.bStart},${bCount} @@`);
    out.push(...h.lines);
  }
  return out.join("\n");
}

type DiffOp = { type: "ctx" | "del" | "add"; aIndex?: number; bIndex?: number };

/** Classic LCS table → sequence of context/delete/add ops over lines. */
function lcsDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "ctx", aIndex: i, bIndex: j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "del", aIndex: i });
      i++;
    } else {
      ops.push({ type: "add", bIndex: j });
      j++;
    }
  }
  while (i < n) ops.push({ type: "del", aIndex: i++ });
  while (j < m) ops.push({ type: "add", bIndex: j++ });
  return ops;
}
