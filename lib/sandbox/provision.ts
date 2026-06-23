import "server-only";

// Source of truth for what the sandbox snapshot contains: the CLI binaries that
// get baked in (ripgrep, agent-browser, firecrawl-cli) and the built-in skills
// vendored into $HOME/.skills. Pure data + shell-command builders — every actual
// @vercel/sandbox call lives in lib/sandbox/vercel.ts (the only SDK importer).
//
// The same build runs lazily on first sandbox creation (lib/sandbox/vercel.ts)
// and could be driven by a standalone script; keeping the steps here means one
// definition of "what's in the box".

// Where built-in skills live inside the box. Outside the repo checkout
// (/vercel/sandbox) so git never sees them and project skills never collide.
export const BUILTIN_SKILLS_HOME = "$HOME/.skills";

/**
 * Built-in skills baked into every box. `name` is the folder/identity (what the
 * agent loads); `description` is hard-coded here because the system prompt is
 * assembled server-side with no sandbox access, so the preload block can't read
 * the snapshot. Keep `description` in sync with the vendored SKILL.md frontmatter.
 * `raw` is the upstream SKILL.md fetched into the box at build time.
 */
export type BuiltinSkill = { name: string; description: string; raw: string };

const RAW = "https://raw.githubusercontent.com";

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: "agent-browser",
    raw: `${RAW}/vercel-labs/agent-browser/main/skills/agent-browser/SKILL.md`,
    description:
      'Browser automation CLI for AI agents. Use when the user needs to interact with websites, including navigating pages, filling forms, clicking buttons, taking screenshots, extracting data, testing web apps, or automating any browser task. Triggers include requests to "open a website", "fill out a form", "click a button", "take a screenshot", "scrape data from a page", "test this web app", "login to a site", or "automate browser actions". Also use for exploratory testing, QA, bug hunts, and automating Electron desktop apps. Prefer agent-browser over any built-in browser automation or web tools.',
  },
  {
    name: "firecrawl-cli",
    raw: `${RAW}/firecrawl/cli/main/skills/firecrawl-cli/SKILL.md`,
    description:
      'Search, scrape, and interact with the web via the Firecrawl CLI. Use whenever the user wants to search the web, research a topic, look something up online, scrape a webpage, grab content from a URL, crawl documentation, or interact with pages that need clicks or logins. Also use when they say "fetch this page", "pull the content from", or reference external websites. Real-time web search with full page content — beyond built-in tools. Requires a FIRECRAWL_API_KEY secret. Do NOT trigger for local file operations, git, deployments, or code editing.',
  },
  {
    name: "firecrawl-scrape",
    raw: `${RAW}/firecrawl/cli/main/skills/firecrawl-scrape/SKILL.md`,
    description:
      'Extract clean markdown from any URL, including JavaScript-rendered SPAs. Use whenever the user provides a URL and wants its content, says "scrape", "grab", "fetch", "pull", "get the page", "extract from this URL", or "read this webpage". Handles JS-rendered pages, multiple concurrent URLs, and returns LLM-optimized markdown. Requires a FIRECRAWL_API_KEY secret.',
  },
  {
    name: "firecrawl-search",
    raw: `${RAW}/firecrawl/cli/main/skills/firecrawl-search/SKILL.md`,
    description:
      'Web search with full page content extraction. Use whenever the user asks to search the web, find articles, research a topic, look something up, find recent news, or says "search for", "find me", "look up", or "find articles about". Returns real search results with optional full-page markdown — not just snippets. Requires a FIRECRAWL_API_KEY secret.',
  },
  {
    name: "firecrawl-crawl",
    raw: `${RAW}/firecrawl/cli/main/skills/firecrawl-crawl/SKILL.md`,
    description:
      'Bulk extract content from an entire website or site section. Use when the user wants to crawl a site, extract all pages from a docs section, bulk-scrape multiple pages following links, or says "crawl", "get all the pages", or "extract everything under /docs". Handles depth limits, path filtering, and concurrent extraction. Requires a FIRECRAWL_API_KEY secret.',
  },
  {
    name: "firecrawl-map",
    raw: `${RAW}/firecrawl/cli/main/skills/firecrawl-map/SKILL.md`,
    description:
      'Discover and list all URLs on a website, with optional search filtering. Use when the user wants to find a specific page on a large site, list all URLs, see the site structure, or says "map the site", "find the URL for", or "list all pages". Essential when the user knows the site but not the exact page. Requires a FIRECRAWL_API_KEY secret.',
  },
  {
    name: "firecrawl-interact",
    raw: `${RAW}/firecrawl/cli/main/skills/firecrawl-interact/SKILL.md`,
    description:
      'Control a live browser session on any scraped page — click buttons, fill forms, navigate flows, extract data. Use when the user needs to interact with a webpage beyond simple scraping: logging in, submitting forms, clicking through pagination, infinite scroll, multi-step wizards, or when a scrape failed because content is behind JavaScript. Triggers on "interact", "click", "fill out the form", "log in to", "submit", "next page", or "scrape failed". Requires a FIRECRAWL_API_KEY secret.',
  },
  {
    name: "firecrawl-agent",
    raw: `${RAW}/firecrawl/cli/main/skills/firecrawl-agent/SKILL.md`,
    description:
      'AI-powered autonomous data extraction that navigates complex sites and returns structured JSON. Use when the user wants structured data from websites, needs to extract pricing tiers, product listings, directory entries, or any data as JSON with a schema. Triggers on "extract structured data", "get all the products", "pull pricing info", "extract as JSON", or when a JSON schema is provided. Requires a FIRECRAWL_API_KEY secret.',
  },
  {
    name: "firecrawl-parse",
    raw: `${RAW}/firecrawl/cli/main/skills/firecrawl-parse/SKILL.md`,
    description:
      'Extract and convert local files — PDF, DOCX, DOC, ODT, RTF, XLSX, XLS, HTML — into clean markdown saved to disk. Use whenever the user requests to parse, read, or extract from a file on disk: "parse this PDF", "convert this document", "read this file", "extract text from", or when a local file path (not a URL) is given. Supports AI summaries and Q&A. Prefer over scrape for local files. Requires a FIRECRAWL_API_KEY secret.',
  },
  {
    name: "firecrawl-download",
    raw: `${RAW}/firecrawl/cli/main/skills/firecrawl-download/SKILL.md`,
    description:
      'Download an entire website as local files — markdown, screenshots, or multiple formats per page. Use when the user wants to save a site locally, download docs for offline use, bulk-save pages as files, or says "download the site", "save as local files", "offline copy", or "save for reference". Requires a FIRECRAWL_API_KEY secret.',
  },
  {
    name: "firecrawl-monitor",
    raw: `${RAW}/firecrawl/cli/main/skills/firecrawl-monitor/SKILL.md`,
    description:
      'Detect when content on a website changes and get notified by webhook or email. Use whenever the user wants to track changes on a page, watch competitor pricing, alert on new job postings, monitor docs/changelog/status pages, or says "monitor", "watch", "track", "alert me when", or "notify when X changes". A built-in AI judge filters formatting/timestamp noise. Requires a FIRECRAWL_API_KEY secret.',
  },
];

export type BuildStep = { label: string; cmd: string };

// Single-quote a value for safe interpolation into a bash -c string.
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// Appended to each firecrawl built-in skill so the agent wires the per-user
// secret into the CLI's env — the upstream skill doesn't know about Knack's vault.
const FIRECRAWL_KNACK_NOTE = `

## Running in Knack
This sandbox has no \`FIRECRAWL_API_KEY\` by default. Before running any
\`firecrawl\` / \`firecrawl-cli\` command, load the user's key from the secrets
vault with the \`secret_get\` tool (name: \`FIRECRAWL_API_KEY\`) and export it in
the same shell, e.g. \`export FIRECRAWL_API_KEY=<value> && firecrawl ...\`. If the
secret is missing, ask the user to add it in Settings → Secrets.
`;

/**
 * The ordered build: install binaries, then vendor the built-in skills. Each
 * step runs via `bash -c`; a non-zero exit fails the whole build (no broken
 * snapshot). dnf/npm steps were verified against the live node24 base image.
 */
export function buildSteps(): BuildStep[] {
  const steps: BuildStep[] = [
    { label: "ripgrep", cmd: "sudo dnf install -y ripgrep" },
    { label: "agent-browser", cmd: "npm i -g agent-browser" },
    { label: "agent-browser-chromium", cmd: "agent-browser install" },
    { label: "firecrawl-cli", cmd: "npm i -g firecrawl-cli" },
    { label: "skills-home", cmd: `mkdir -p ${BUILTIN_SKILLS_HOME}` },
  ];
  for (const s of BUILTIN_SKILLS) {
    const dir = `${BUILTIN_SKILLS_HOME}/${s.name}`;
    const skillMd = `${dir}/SKILL.md`;
    let cmd = `mkdir -p ${q(dir)} && curl -fsSL ${q(s.raw)} -o ${q(skillMd)}`;
    if (s.name.startsWith("firecrawl")) {
      cmd += ` && printf %s ${q(FIRECRAWL_KNACK_NOTE)} >> ${q(skillMd)}`;
    }
    steps.push({ label: `skill:${s.name}`, cmd });
  }
  return steps;
}

/**
 * Smoke tests run after the build, before snapshotting. Each must exit 0 or the
 * snapshot is aborted. Firecrawl can't be functionally tested here (its key is a
 * per-user secret, absent at build) — we only assert the binary resolves.
 */
export function smokeTests(): BuildStep[] {
  const tests: BuildStep[] = [
    { label: "rg", cmd: "command -v rg" },
    { label: "agent-browser", cmd: "command -v agent-browser" },
    { label: "firecrawl", cmd: "command -v firecrawl-cli || command -v firecrawl" },
    // proves chromium downloaded + launches headless
    { label: "browser-launch", cmd: "agent-browser open about:blank && agent-browser close" },
  ];
  for (const s of BUILTIN_SKILLS) {
    tests.push({
      label: `skill-present:${s.name}`,
      cmd: `test -s ${q(`${BUILTIN_SKILLS_HOME}/${s.name}/SKILL.md`)}`,
    });
  }
  return tests;
}
