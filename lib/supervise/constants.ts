// The longest a function can run on any Vercel plan (Pro/Enterprise max is 30
// min per the docs); the platform kills it at maxDuration regardless of what we
// set. The lease must outlast the longest possible healthy cycle, so we size it
// to this max + a margin. Tradeoff: a genuinely-dead cycle waits ~this long to
// be reclaimed — correctness (never double-run) over fast retry.
export const MAX_RUN_SECONDS = 1800;
export const LEASE_MS = (MAX_RUN_SECONDS + 120) * 1000;
