// Curated, code-defined list of "built-in" token names the system/skills look
// for (e.g. the firecrawl skills load FIRECRAWL_API_KEY via `secret_get`). These
// get special treatment in the UI: pinned to the top of each user's Secrets tab
// and surfaced in the admin global-tokens page. Admins/users set the VALUES;
// the list itself is fixed here. Extend by adding an entry.
//
// Client-safe: metadata only, no values. Import from both server and client.

export type BuiltinToken = {
  name: string; // the secret name, e.g. "FIRECRAWL_API_KEY"
  label: string; // human label, e.g. "Firecrawl"
  hint: string; // one-line explanation of what it's for
  url: string; // where to get a key
};

export const BUILTIN_TOKENS: BuiltinToken[] = [
  {
    name: "FIRECRAWL_API_KEY",
    label: "Firecrawl",
    hint: "Web search and scraping for the built-in firecrawl skills.",
    url: "https://firecrawl.dev/app/api-keys",
  },
];

export const BUILTIN_TOKEN_NAMES: string[] = BUILTIN_TOKENS.map((b) => b.name);

export function isBuiltinToken(name: string): boolean {
  return BUILTIN_TOKEN_NAMES.includes(name);
}
