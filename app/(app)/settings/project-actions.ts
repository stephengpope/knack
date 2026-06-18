"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  connectGithub,
  disconnectGithub,
} from "@/lib/github-account";
import {
  createProject,
  setDefaultProject,
  deleteProject,
  type ProjectSummary,
} from "@/lib/projects";

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

export async function setDefaultProjectAction(id: string): Promise<void> {
  const user = await requireUser();
  await setDefaultProject(user.id, id);
  revalidatePath("/settings");
}

export async function deleteProjectAction(id: string): Promise<void> {
  const user = await requireUser();
  await deleteProject(user.id, id);
  revalidatePath("/settings");
}
