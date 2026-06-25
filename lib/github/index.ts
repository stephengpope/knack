import "server-only";

// Minimal GitHub REST client (raw fetch, no Octokit). All calls are
// authenticated with a user's Personal Access Token. Server-only — a PAT must
// never reach the client.

const API = "https://api.github.com";

function headers(pat: string): Record<string, string> {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export type GithubUser = { login: string; id: number; name: string | null };

/** Validate a PAT and return the owning account. Throws on invalid/expired. */
export async function verifyPat(pat: string): Promise<GithubUser> {
  const res = await fetch(`${API}/user`, { headers: headers(pat) });
  if (res.status === 401) throw new Error("Invalid or expired GitHub token.");
  if (!res.ok) throw new Error(`GitHub error (${res.status}).`);
  const j = (await res.json()) as { login: string; id: number; name?: string };
  return { login: j.login, id: j.id, name: j.name ?? null };
}

export type CreatedRepo = {
  owner: string;
  repo: string;
  fullName: string;
  defaultBranch: string;
  htmlUrl: string;
};

/** Create an empty repo under the authenticated user. No auto_init (no README)
 * — the first putFile creates the initial commit and the default branch. */
export async function createRepo(
  pat: string,
  input: { name: string; private?: boolean; description?: string },
): Promise<CreatedRepo> {
  const res = await fetch(`${API}/user/repos`, {
    method: "POST",
    headers: { ...headers(pat), "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      description: input.description,
      private: input.private ?? true,
      auto_init: false,
    }),
  });
  if (res.status === 422) {
    throw new Error("A repo with that name already exists, or the name is invalid.");
  }
  if (res.status === 403) {
    throw new Error("Token lacks permission to create repositories (needs the 'repo' scope).");
  }
  if (!res.ok) throw new Error(`Couldn't create repository (${res.status}).`);
  const j = (await res.json()) as {
    name: string;
    full_name: string;
    default_branch: string;
    html_url: string;
    owner: { login: string };
  };
  return {
    owner: j.owner.login,
    repo: j.name,
    fullName: j.full_name,
    defaultBranch: j.default_branch ?? "main",
    htmlUrl: j.html_url,
  };
}

export type RepoListItem = {
  owner: string;
  repo: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
};

/**
 * List repos the PAT can see (owner + collaborator + org member), most-recently
 * pushed first. Powers the "add existing" picker. Capped at 5 pages (500 repos)
 * — it's a UI picker, not a full inventory; the picker also accepts a pasted
 * owner/repo for anything past the cap.
 */
export async function listRepos(pat: string): Promise<RepoListItem[]> {
  const out: RepoListItem[] = [];
  const perPage = 100;
  for (let page = 1; page <= 5; page++) {
    const url = new URL(`${API}/user/repos`);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    url.searchParams.set("sort", "pushed");
    url.searchParams.set("affiliation", "owner,collaborator,organization_member");
    const res = await fetch(url, { headers: headers(pat) });
    if (res.status === 401) throw new Error("Invalid or expired GitHub token.");
    if (!res.ok) throw new Error(`Couldn't list repositories (${res.status}).`);
    const batch = (await res.json()) as {
      name: string;
      full_name: string;
      private: boolean;
      default_branch: string;
      html_url: string;
      owner: { login: string };
    }[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const r of batch) {
      out.push({
        owner: r.owner.login,
        repo: r.name,
        fullName: r.full_name,
        private: !!r.private,
        defaultBranch: r.default_branch ?? "main",
        htmlUrl: r.html_url,
      });
    }
    if (batch.length < perPage) break;
  }
  return out;
}

/**
 * Fetch a single repo's canonical metadata. Used to validate a repo before
 * linking it as a project (existence + that the PAT has push access). Throws a
 * user-facing message on 404 (not found / not visible) and on missing write.
 */
export async function getRepo(
  pat: string,
  owner: string,
  repo: string,
): Promise<CreatedRepo> {
  const res = await fetch(`${API}/repos/${owner}/${repo}`, {
    headers: headers(pat),
  });
  if (res.status === 401) throw new Error("Invalid or expired GitHub token.");
  if (res.status === 404) {
    throw new Error("Repository not found, or your token can't see it.");
  }
  if (!res.ok) throw new Error(`Couldn't read repository (${res.status}).`);
  const j = (await res.json()) as {
    name: string;
    full_name: string;
    default_branch: string;
    html_url: string;
    owner: { login: string };
    permissions?: { push?: boolean };
  };
  if (j.permissions && !j.permissions.push) {
    throw new Error(
      "Your token can read this repo but can't push to it (needs write access).",
    );
  }
  return {
    owner: j.owner.login,
    repo: j.name,
    fullName: j.full_name,
    defaultBranch: j.default_branch ?? "main",
    htmlUrl: j.html_url,
  };
}

/** Create or overwrite a single file via the Contents API (one commit). */
export async function putFile(
  pat: string,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
): Promise<void> {
  // Encode each segment but keep the slashes — the Contents API needs literal
  // separators to create nested paths (e.g. `.attachments/.gitignore`).
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(
    `${API}/repos/${owner}/${repo}/contents/${encodedPath}`,
    {
      method: "PUT",
      headers: { ...headers(pat), "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        content: Buffer.from(content, "utf8").toString("base64"),
      }),
    },
  );
  if (!res.ok) throw new Error(`Couldn't write ${path} (${res.status}).`);
}

/** Read a file's raw text. Returns null on 404 (file absent). */
export async function getFileContents(
  pat: string,
  owner: string,
  repo: string,
  path: string,
  ref?: string,
): Promise<string | null> {
  const url = new URL(
    `${API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
  );
  if (ref) url.searchParams.set("ref", ref);
  const res = await fetch(url, {
    headers: { ...headers(pat), Accept: "application/vnd.github.raw+json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Couldn't read ${path} (${res.status}).`);
  return res.text();
}

/**
 * Conditional read of a file's raw text. Pass the ETag from a previous call as
 * `etag`; GitHub returns 304 (no body, and — importantly — not counted against
 * the rate limit) when the file is unchanged. Used by the cron dispatcher to
 * poll each repo's `cron.json` cheaply every tick.
 *   - 200: file present and changed/new — `content` + fresh `etag` returned.
 *   - 304: unchanged — caller should use its cached parse.
 *   - 404: file absent.
 */
export async function getFileContentsConditional(
  pat: string,
  owner: string,
  repo: string,
  path: string,
  ref?: string,
  etag?: string | null,
): Promise<{ status: 200 | 304 | 404; content?: string; etag?: string }> {
  const url = new URL(
    `${API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
  );
  if (ref) url.searchParams.set("ref", ref);
  const h: Record<string, string> = {
    ...headers(pat),
    Accept: "application/vnd.github.raw+json",
  };
  if (etag) h["If-None-Match"] = etag;
  const res = await fetch(url, { headers: h, cache: "no-store" });
  if (res.status === 304) return { status: 304 };
  if (res.status === 404) return { status: 404 };
  if (!res.ok) throw new Error(`Couldn't read ${path} (${res.status}).`);
  return {
    status: 200,
    content: await res.text(),
    etag: res.headers.get("etag") ?? undefined,
  };
}

export type RepoDirEntry = { name: string; type: "file" | "dir" };

/**
 * List the entries directly under a directory in a repo (one Contents-API call).
 * Returns [] when the directory doesn't exist (404). Used to discover skills
 * under `.skills/` without pulling the whole repo tree.
 */
export async function listRepoDir(
  pat: string,
  owner: string,
  repo: string,
  path: string,
  ref?: string,
): Promise<RepoDirEntry[]> {
  const url = new URL(
    `${API}/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`,
  );
  if (ref) url.searchParams.set("ref", ref);
  const res = await fetch(url, { headers: headers(pat) });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Couldn't list ${path} (${res.status}).`);
  const json = (await res.json()) as { name: string; type: string }[];
  // A directory path returns an array; a file path returns an object. Guard so
  // pointing at a file doesn't throw.
  if (!Array.isArray(json)) return [];
  return json.map((e) => ({
    name: e.name,
    type: e.type === "dir" ? "dir" : "file",
  }));
}

export type TreeEntry = { path: string; type: "blob" | "tree"; sha: string };

/**
 * Read a git tree via the Trees API. Pass a branch name or tree SHA as `treeish`.
 * `recursive` returns the whole subtree in one call (any depth). `truncated` is
 * true only for very large trees (>100k entries) — not a concern scoped to a
 * `.skills/` subtree. Returns [] when the tree/ref doesn't exist (404).
 */
export async function getTree(
  pat: string,
  owner: string,
  repo: string,
  treeish: string,
  recursive = false,
): Promise<{ tree: TreeEntry[]; truncated: boolean }> {
  const url = new URL(
    `${API}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(treeish)}`,
  );
  if (recursive) url.searchParams.set("recursive", "1");
  const res = await fetch(url, { headers: headers(pat) });
  if (res.status === 404) return { tree: [], truncated: false };
  if (!res.ok) throw new Error(`Couldn't read tree ${treeish} (${res.status}).`);
  const json = (await res.json()) as {
    tree?: { path: string; type: string; sha: string }[];
    truncated?: boolean;
  };
  const tree = (json.tree ?? [])
    .filter((e) => e.type === "blob" || e.type === "tree")
    .map((e) => ({ path: e.path, type: e.type as "blob" | "tree", sha: e.sha }));
  return { tree, truncated: json.truncated ?? false };
}

/** HTTPS clone URL with the PAT embedded for git auth inside the sandbox. */
export function cloneUrlWithToken(
  pat: string,
  owner: string,
  repo: string,
): string {
  return `https://x-access-token:${pat}@github.com/${owner}/${repo}.git`;
}
