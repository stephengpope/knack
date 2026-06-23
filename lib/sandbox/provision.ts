import "server-only";
import { VENDORED_FIRECRAWL_SKILLS } from "./builtin-skills";

// Source of truth for what the sandbox snapshot contains: the CLI binaries baked
// in (ripgrep, agent-browser, firecrawl-cli) and the built-in skills written into
// $HOME/.skills. Pure data + shell-command builders — every actual @vercel/sandbox
// call lives in lib/sandbox/vercel.ts (the only SDK importer).
//
// Skill bodies come from trusted local sources, never a build-time fetch of a
// foreign repo: agent-browser ships its SKILL.md inside its npm package (copied
// from disk, version-matched); firecrawl's are vendored in ./builtin-skills.ts.

// Where built-in skills live inside the box. Outside the repo checkout
// (/vercel/sandbox) so git never sees them and project skills never collide.
export const BUILTIN_SKILLS_HOME = "$HOME/.skills";

/**
 * Built-in skills baked into every box, for the system-prompt preload. `name` is
 * the folder/identity; `description` is hard-coded because the prompt is built
 * server-side with no sandbox to scan. Keep in sync with the vendored SKILL.md
 * frontmatter. The bodies themselves are placed in the box at build time (see
 * buildSteps + the vendored firecrawl skills), not from here.
 */
export type BuiltinSkill = { name: string; description: string };

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: "agent-browser",
    description:
      'Browser automation CLI for AI agents. Use when the user needs to interact with websites, including navigating pages, filling forms, clicking buttons, taking screenshots, extracting data, testing web apps, or automating any browser task. Triggers include requests to "open a website", "fill out a form", "click a button", "take a screenshot", "scrape data from a page", "test this web app", "login to a site", or "automate browser actions". Also use for exploratory testing, QA, bug hunts, and automating Electron desktop apps. Prefer agent-browser over any built-in browser automation or web tools.',
  },
  {
    name: "firecrawl-cli",
    description:
      'Search, scrape, and interact with the web via the Firecrawl CLI. Use whenever the user wants to search the web, research a topic, look something up online, scrape a webpage, grab content from a URL, crawl documentation, or interact with pages that need clicks or logins. Also use when they say "fetch this page", "pull the content from", or reference external websites. Real-time web search with full page content — beyond built-in tools. Requires a FIRECRAWL_API_KEY secret. Do NOT trigger for local file operations, git, deployments, or code editing.',
  },
  {
    name: "firecrawl-scrape",
    description:
      'Extract clean markdown from any URL, including JavaScript-rendered SPAs. Use whenever the user provides a URL and wants its content, says "scrape", "grab", "fetch", "pull", "get the page", "extract from this URL", or "read this webpage". Handles JS-rendered pages, multiple concurrent URLs, and returns LLM-optimized markdown. Requires a FIRECRAWL_API_KEY secret.',
  },
  {
    name: "firecrawl-search",
    description:
      'Web search with full page content extraction. Use whenever the user asks to search the web, find articles, research a topic, look something up, find recent news, or says "search for", "find me", "look up", or "find articles about". Returns real search results with optional full-page markdown — not just snippets. Requires a FIRECRAWL_API_KEY secret.',
  },
  {
    name: "firecrawl-crawl",
    description:
      'Bulk extract content from an entire website or site section. Use when the user wants to crawl a site, extract all pages from a docs section, bulk-scrape multiple pages following links, or says "crawl", "get all the pages", or "extract everything under /docs". Handles depth limits, path filtering, and concurrent extraction. Requires a FIRECRAWL_API_KEY secret.',
  },
  {
    name: "firecrawl-map",
    description:
      'Discover and list all URLs on a website, with optional search filtering. Use when the user wants to find a specific page on a large site, list all URLs, see the site structure, or says "map the site", "find the URL for", or "list all pages". Essential when the user knows the site but not the exact page. Requires a FIRECRAWL_API_KEY secret.',
  },
  {
    name: "firecrawl-interact",
    description:
      'Control a live browser session on any scraped page — click buttons, fill forms, navigate flows, extract data. Use when the user needs to interact with a webpage beyond simple scraping: logging in, submitting forms, clicking through pagination, infinite scroll, multi-step wizards, or when a scrape failed because content is behind JavaScript. Triggers on "interact", "click", "fill out the form", "log in to", "submit", "next page", or "scrape failed". Requires a FIRECRAWL_API_KEY secret.',
  },
  {
    name: "firecrawl-agent",
    description:
      'AI-powered autonomous data extraction that navigates complex sites and returns structured JSON. Use when the user wants structured data from websites, needs to extract pricing tiers, product listings, directory entries, or any data as JSON with a schema. Triggers on "extract structured data", "get all the products", "pull pricing info", "extract as JSON", or when a JSON schema is provided. Requires a FIRECRAWL_API_KEY secret.',
  },
  {
    name: "firecrawl-parse",
    description:
      'Extract and convert local files — PDF, DOCX, DOC, ODT, RTF, XLSX, XLS, HTML — into clean markdown saved to disk. Use whenever the user requests to parse, read, or extract from a file on disk: "parse this PDF", "convert this document", "read this file", "extract text from", or when a local file path (not a URL) is given. Supports AI summaries and Q&A. Prefer over scrape for local files. Requires a FIRECRAWL_API_KEY secret.',
  },
  {
    name: "firecrawl-download",
    description:
      'Download an entire website as local files — markdown, screenshots, or multiple formats per page. Use when the user wants to save a site locally, download docs for offline use, bulk-save pages as files, or says "download the site", "save as local files", "offline copy", or "save for reference". Requires a FIRECRAWL_API_KEY secret.',
  },
  {
    name: "firecrawl-monitor",
    description:
      'Detect when content on a website changes and get notified by webhook or email. Use whenever the user wants to track changes on a page, watch competitor pricing, alert on new job postings, monitor docs/changelog/status pages, or says "monitor", "watch", "track", "alert me when", or "notify when X changes". A built-in AI judge filters formatting/timestamp noise. Requires a FIRECRAWL_API_KEY secret.',
  },
];

export type BuildStep = { label: string; cmd: string };

// Single-quote a value for safe interpolation into a bash -c string.
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// System libraries headless Chrome needs on Amazon Linux 2023 (the node24 base).
// Without these, agent-browser's bundled Chrome fails with libnspr4.so / DevTools
// errors. Verified live.
const CHROMIUM_DEPS = [
  "nss", "nspr", "libxkbcommon", "atk", "at-spi2-atk", "at-spi2-core",
  "libXcomposite", "libXdamage", "libXrandr", "libXfixes", "libXcursor",
  "libXi", "libXtst", "libXScrnSaver", "libXext", "mesa-libgbm", "libdrm",
  "mesa-libGL", "mesa-libEGL", "cups-libs", "alsa-lib", "pango", "cairo",
  "gtk3", "dbus-libs",
].join(" ");

// ripgrep isn't in the AL2023 dnf repos (and EPEL doesn't resolve it), so we drop
// in the official static musl binary. Best-effort: search_files falls back to
// grep/find, so a failed rg install must never abort the snapshot.
const RIPGREP_VERSION = "14.1.1";
const RIPGREP_URL =
  `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/` +
  `ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl.tar.gz`;

/**
 * Ordered shell build: install binaries, then place agent-browser's bundled
 * skill from its installed package (no network). The firecrawl skills are
 * written separately by the build driver from the vendored bodies. Each step
 * runs via `bash -c`; a non-zero exit fails the whole build (no broken
 * snapshot). dnf/npm steps were verified against the live node24 base image.
 */
export function buildSteps(): BuildStep[] {
  return [
    // Chrome system libs first — agent-browser's chromium needs them.
    { label: "chromium-deps", cmd: `sudo dnf install -y --skip-broken ${CHROMIUM_DEPS} && sudo ldconfig` },
    { label: "agent-browser", cmd: "npm i -g agent-browser" },
    { label: "agent-browser-chromium", cmd: "agent-browser install" },
    { label: "firecrawl-cli", cmd: "npm i -g firecrawl-cli" },
    // ripgrep: official static binary, best-effort (|| true) — grep fallback exists.
    {
      label: "ripgrep",
      cmd:
        `curl -fsSL ${q(RIPGREP_URL)} -o /tmp/rg.tgz && tar xzf /tmp/rg.tgz -C /tmp && ` +
        `sudo cp /tmp/ripgrep-*/rg /usr/local/bin/rg || true`,
    },
    { label: "skills-home", cmd: `mkdir -p ${BUILTIN_SKILLS_HOME}` },
    {
      // agent-browser ships its SKILL.md inside the npm package (files: skills/).
      label: "skill:agent-browser",
      cmd:
        `cp -r "$(npm root -g)/agent-browser/skills/agent-browser" ` +
        `${BUILTIN_SKILLS_HOME}/`,
    },
  ];
}

/** Vendored firecrawl skills to write into the box (name → SKILL.md body). */
export function vendoredSkills(): { name: string; content: string }[] {
  return VENDORED_FIRECRAWL_SKILLS;
}

/**
 * Smoke tests run after the build, before snapshotting. Each must exit 0 or the
 * snapshot is aborted. Firecrawl can't be functionally tested here (its key is a
 * per-user secret, absent at build) — we only assert the binary resolves and the
 * skill files landed.
 */
export function smokeTests(): BuildStep[] {
  const tests: BuildStep[] = [
    // rg is best-effort (grep fallback), so it's intentionally NOT asserted here.
    { label: "agent-browser", cmd: "command -v agent-browser" },
    { label: "firecrawl", cmd: "command -v firecrawl-cli || command -v firecrawl" },
    // proves chromium downloaded + launches headless
    { label: "browser-launch", cmd: "agent-browser open about:blank && agent-browser close" },
  ];
  for (const s of BUILTIN_SKILLS) {
    tests.push({
      // Double-quoted so $HOME expands (single-quoting it was the bug that made
      // every snapshot build fail). Skill names are a controlled charset.
      label: `skill-present:${s.name}`,
      cmd: `test -s "${BUILTIN_SKILLS_HOME}/${s.name}/SKILL.md"`,
    });
  }
  return tests;
}
