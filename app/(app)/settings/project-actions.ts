"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  connectGithub,
  disconnectGithub,
} from "@/lib/github-account";
import {
  createProject,
  addExistingProject,
  setDefaultProject,
  setProjectActive,
  deleteProject,
  type ProjectSummary,
} from "@/lib/projects";
import { getGithubAuth } from "@/lib/github-account";
import { listRepos, type RepoListItem } from "@/lib/github";

// GitHub repo name rules: letters, numbers, dot, dash, underscore.
const REPO_RE = /^[\w.-]{1,100}$/;

export async function connectGithubAction(input: {
  pat: string;
}): Promise<{ login: string }> {
  const user = await requireUser();
  const pat = input.pat.trim();
  if (!pat) throw new Error("Paste a GitHub personal access token.");
  const { login } = await connectGithub(user.id, pat); // throws on invalid
  revalidatePath("/settings");
  return { login };
}

export async function disconnectGithubAction(): Promise<void> {
  const user = await requireUser();
  await disconnectGithub(user.id);
  revalidatePath("/settings");
}

export async function createProjectAction(input: {
  name: string;
  repoName: string;
  private: boolean;
}): Promise<ProjectSummary> {
  const user = await requireUser();
  const name = input.name.trim();
  const repoName = input.repoName.trim();
  if (!name) throw new Error("Project name is required.");
  if (!REPO_RE.test(repoName)) {
    throw new Error(
      "Repo name must be 1–100 chars: letters, numbers, dot, dash, underscore.",
    );
  }
  const summary = await createProject(user.id, {
    name,
    repoName,
    private: input.private,
  });
  revalidatePath("/settings");
  return summary;
}

/** List the connected account's repos for the "add existing" picker. The PAT
 *  stays server-side — only repo coordinates cross to the client. */
export async function listReposAction(): Promise<RepoListItem[]> {
  const user = await requireUser();
  const auth = await getGithubAuth(user.id);
  if (!auth) throw new Error("Connect a GitHub account first.");
  return listRepos(auth.pat);
}

// "owner/repo", tolerating a full github.com URL or a trailing .git.
const OWNER_REPO_RE = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/;

export async function addExistingProjectAction(input: {
  repoFullName: string;
}): Promise<ProjectSummary> {
  const user = await requireUser();
  const raw = input.repoFullName
    .trim()
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\/+$/, "");
  const m = OWNER_REPO_RE.exec(raw);
  if (!m) {
    throw new Error("Enter a repo as owner/repo (or paste its GitHub URL).");
  }
  const summary = await addExistingProject(user.id, {
    owner: m[1],
    repo: m[2],
  });
  revalidatePath("/settings");
  return summary;
}

export async function setDefaultProjectAction(id: string): Promise<void> {
  const user = await requireUser();
  await setDefaultProject(user.id, id);
  revalidatePath("/settings");
}

export async function setProjectActiveAction(
  id: string,
  active: boolean,
): Promise<void> {
  const user = await requireUser();
  await setProjectActive(user.id, id, active); // throws if deactivating the default
  revalidatePath("/settings");
}

export async function deleteProjectAction(id: string): Promise<void> {
  const user = await requireUser();
  await deleteProject(user.id, id);
  revalidatePath("/settings");
}
