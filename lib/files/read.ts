import "server-only";
import type { SandboxBox } from "@/lib/sandbox/types";

// Mirrors hermes' read_file: paginated, line-numbered reads. Output format is
// `LINE|CONTENT` (compact, no padding — hermes A/B-tested that padded gutters
// cost ~16% more tokens with no accuracy gain on patch/line-reference tasks).

const MAX_READ_CHARS = 100_000; // reject slices larger than this; narrow instead
const MAX_LINE_CHARS = 2_000; // truncate pathologically long single lines
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2_000;

export type ReadResult =
  | { content: string; lines: number; start: number; end: number; truncated: boolean }
  | { error: string; suggestions?: string[] };

function truncateLine(line: string): string {
  return line.length > MAX_LINE_CHARS
    ? line.slice(0, MAX_LINE_CHARS) + " … [truncated]"
    : line;
}

/** Score a candidate basename against the wanted one for "did you mean?" hints. */
function scoreName(want: string, cand: string): number {
  if (want === cand) return 100;
  let s = 0;
  if (cand.includes(want) || want.includes(cand)) s += 60;
  const we = want.includes(".") ? want.slice(want.lastIndexOf(".")) : "";
  const ce = cand.includes(".") ? cand.slice(cand.lastIndexOf(".")) : "";
  if (we && we === ce) s += 30;
  let p = 0;
  while (p < want.length && p < cand.length && want[p] === cand[p]) p++;
  s += Math.min(p, 20);
  return s;
}

async function suggestSimilar(box: SandboxBox, path: string): Promise<string[]> {
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash) || "/" : ".";
  const base = (slash >= 0 ? path.slice(slash + 1) : path).toLowerCase();
  let listing: string;
  try {
    listing = await box.listDir(dir);
  } catch {
    return [];
  }
  return listing
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((e) => [scoreName(base, e.toLowerCase()), e] as [number, string])
    .filter(([score]) => score > 20)
    .sort((a, b) => b[0] - a[0])
    .slice(0, 5)
    .map(([, e]) => (dir === "." ? e : `${dir.replace(/\/$/, "")}/${e}`));
}

export async function fileRead(
  box: SandboxBox,
  path: string,
  offset = 1,
  limit = DEFAULT_LIMIT,
): Promise<ReadResult> {
  let raw: string;
  try {
    raw = await box.readFile(path);
  } catch {
    const suggestions = await suggestSimilar(box, path);
    return {
      error: `File not found: ${path}.`,
      ...(suggestions.length ? { suggestions } : {}),
    };
  }

  const allLines = raw.split("\n");
  const total = allLines.length;
  const start = Math.max(1, Math.floor(offset) || 1);
  const lim = Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit) || DEFAULT_LIMIT));

  if (start > total) {
    return { error: `offset ${start} is past end of file (${total} lines).` };
  }

  const end = Math.min(total, start + lim - 1);
  const rendered = allLines
    .slice(start - 1, end)
    .map((line, i) => `${start + i}|${truncateLine(line)}`)
    .join("\n");

  if (rendered.length > MAX_READ_CHARS) {
    return {
      error:
        `Selected range is ${rendered.length} chars, over the ${MAX_READ_CHARS} ` +
        `cap. File has ${total} lines — narrow with a smaller limit or a ` +
        `targeted offset.`,
    };
  }

  return { content: rendered, lines: end - start + 1, start, end, truncated: end < total };
}
