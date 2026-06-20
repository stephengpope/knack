import "server-only";
import type { SandboxBox } from "@/lib/sandbox/types";

// Mirrors hermes' search_files: one tool, two targets. `content` greps inside
// files (ripgrep-backed, grep fallback); `files` finds files by glob (rg --files,
// find fallback). All shelled through `bash -c` so a missing `rg` surfaces as
// exit 127 and we transparently fall back.

export type SearchArgs = {
  pattern: string;
  target?: "content" | "files";
  path?: string;
  file_glob?: string;
  output_mode?: "content" | "files_only" | "count";
  context?: number;
  limit?: number;
  offset?: number;
};

export type SearchMatch = { path: string; line: number; text: string; context?: boolean };

export type SearchResult =
  | { matches: SearchMatch[]; truncated: boolean; engine: string }
  | { files: string[]; truncated: boolean; engine: string }
  | { counts: Record<string, number>; truncated: boolean; engine: string }
  | { error: string };

const FETCH_CAP = 4000; // hard line cap pulled from the search before slicing

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

async function sh(box: SandboxBox, cmd: string) {
  return box.run("bash", ["-c", cmd]);
}

/** rg/grep exit 1 = "no matches" (not an error); 127 = binary missing. */
function notFound(r: { exitCode: number; stderr: string }): boolean {
  return r.exitCode === 127 || /command not found|not found/i.test(r.stderr);
}

export async function searchFiles(box: SandboxBox, args: SearchArgs): Promise<SearchResult> {
  const pattern = args.pattern;
  if (!pattern) return { error: "pattern is required." };
  const target = args.target ?? "content";
  const path = args.path ?? ".";
  const limit = Math.max(1, Math.floor(args.limit ?? 50));
  const offset = Math.max(0, Math.floor(args.offset ?? 0));

  return target === "files"
    ? findFiles(box, pattern, path, limit, offset)
    : grepContent(box, args, path, limit, offset);
}

async function findFiles(
  box: SandboxBox,
  glob: string,
  path: string,
  limit: number,
  offset: number,
): Promise<SearchResult> {
  let engine = "ripgrep";
  let r = await sh(box, `rg --files ${shq(path)} -g ${shq(glob)} 2>&1 | head -n ${FETCH_CAP}`);
  if (notFound(r)) {
    engine = "find";
    r = await sh(box, `find ${shq(path)} -type f -name ${shq(glob)} 2>/dev/null | head -n ${FETCH_CAP}`);
  }
  const all = r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  const files = all.slice(offset, offset + limit);
  return { files, truncated: all.length > offset + limit, engine };
}

async function grepContent(
  box: SandboxBox,
  args: SearchArgs,
  path: string,
  limit: number,
  offset: number,
): Promise<SearchResult> {
  const mode = args.output_mode ?? "content";
  const ctx = Math.max(0, Math.floor(args.context ?? 0));
  const glob = args.file_glob;

  // ── ripgrep ──
  const rgFlags: string[] = ["--no-heading", "--color", "never"];
  if (mode === "files_only") rgFlags.push("-l");
  else if (mode === "count") rgFlags.push("-c");
  else {
    rgFlags.push("--line-number", "--with-filename");
    if (ctx) rgFlags.push("-C", String(ctx));
  }
  if (glob) rgFlags.push("-g", shq(glob));
  const rgCmd =
    `rg ${rgFlags.join(" ")} -e ${shq(args.pattern)} ${shq(path)} 2>&1 | head -n ${FETCH_CAP}`;

  let engine = "ripgrep";
  let r = await sh(box, rgCmd);
  if (notFound(r)) {
    engine = "grep";
    const gFlags: string[] = ["-r", "-I"];
    if (mode === "files_only") gFlags.push("-l");
    else if (mode === "count") gFlags.push("-c");
    else {
      gFlags.push("-n");
      if (ctx) gFlags.push("-C", String(ctx));
    }
    if (glob) gFlags.push(`--include=${shq(glob)}`);
    r = await sh(
      box,
      `grep ${gFlags.join(" ")} -e ${shq(args.pattern)} ${shq(path)} 2>/dev/null | head -n ${FETCH_CAP}`,
    );
  }

  const lines = r.stdout.split("\n").filter((l) => l.length > 0 && l !== "--");

  if (mode === "files_only") {
    const all = lines.map((l) => l.trim()).filter(Boolean);
    return { files: all.slice(offset, offset + limit), truncated: all.length > offset + limit, engine };
  }

  if (mode === "count") {
    const counts: Record<string, number> = {};
    for (const l of lines) {
      const idx = l.lastIndexOf(":");
      if (idx < 0) continue;
      const n = Number(l.slice(idx + 1));
      if (Number.isFinite(n) && n > 0) counts[l.slice(0, idx)] = n;
    }
    return { counts, truncated: false, engine };
  }

  // content mode: parse `file:line:text` (match) and `file-line-text` (context)
  const parsed: SearchMatch[] = [];
  for (const l of lines) {
    const m = /^(.*?):(\d+):(.*)$/.exec(l);
    if (m) {
      parsed.push({ path: m[1], line: Number(m[2]), text: m[3].slice(0, 500) });
      continue;
    }
    const c = /^(.*?)-(\d+)-(.*)$/.exec(l);
    if (c) parsed.push({ path: c[1], line: Number(c[2]), text: c[3].slice(0, 500), context: true });
  }
  const matchCount = parsed.filter((p) => !p.context).length;
  return {
    matches: parsed.slice(offset, offset + limit),
    truncated: matchCount > offset + limit,
    engine,
  };
}
