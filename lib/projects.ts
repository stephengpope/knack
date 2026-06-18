import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { project, type Project } from "@/lib/db/schema";
import { getGithubAuth } from "@/lib/github-account";
import { createRepo, putFile } from "@/lib/github";
import { readTemplate } from "@/lib/prompt/files";

export type ProjectSummary = {
  id: string;
  name: string;
  repoFullName: string;
  htmlUrl: string;
  isDefault: boolean;
};

function toSummary(p: Project): ProjectSummary {
  return {
    id: p.id,
    name: p.name,
    repoFullName: p.repoFullName,
    htmlUrl: p.htmlUrl,
    isDefault: p.isDefault,
  };
}

export async function listProjects(userId: string): Promise<ProjectSummary[]> {
  const rows = await db
    .select()
    .from(project)
    .where(eq(project.userId, userId))
    .orderBy(desc(project.createdAt));
  return rows.map(toSummary);
}

export async function getProject(
  userId: string,
  id: string,
): Promise<Project | null> {
  const [row] = await db
    .select()
    .from(project)
    .where(and(eq(project.userId, userId), eq(project.id, id)))
    .limit(1);
  return row ?? null;
}

export async function getDefaultProject(
  userId: string,
): Promise<Project | null> {
  const [row] = await db
    .select()
    .from(project)
    .where(and(eq(project.userId, userId), eq(project.isDefault, true)))
    .limit(1);
  return row ?? null;
}

/**
 * Create a GitHub repo from the bundled template and record it as a project.
 * Requires a connected GitHub account. The first project becomes the default.
 */
export async function createProject(
  userId: string,
  input: { name: string; repoName: string; private?: boolean },
): Promise<ProjectSummary> {
  const auth = await getGithubAuth(userId);
  if (!auth) throw new Error("Connect a GitHub account first.");

  const repo = await createRepo(auth.pat, {
    name: input.repoName,
    private: input.private ?? true,
    description: `Knack project: ${input.name}`,
  });

  // Seed the template files (sequential — each Contents commit builds on the
  // previous, so concurrent writes to the same branch would race).
  const files = await readTemplate();
  for (const f of files) {
    await putFile(
      auth.pat,
      repo.owner,
      repo.repo,
      f.path,
      f.content,
      `Add ${f.path}`,
    );
  }

  const existing = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.userId, userId))
    .limit(1);
  const isDefault = existing.length === 0;

  const id = nanoid();
  await db.insert(project).values({
    id,
    userId,
    name: input.name.trim(),
    repoOwner: repo.owner,
    repoName: repo.repo,
    repoFullName: repo.fullName,
    defaultBranch: repo.defaultBranch,
    htmlUrl: repo.htmlUrl,
    isDefault,
  });

  return {
    id,
    name: input.name.trim(),
    repoFullName: repo.fullName,
    htmlUrl: repo.htmlUrl,
    isDefault,
  };
}

/** Make one project the user's default (clears the flag on the others). */
export async function setDefaultProject(
  userId: string,
  id: string,
): Promise<void> {
  await db
    .update(project)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(and(eq(project.userId, userId), eq(project.isDefault, true)));
  await db
    .update(project)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(and(eq(project.userId, userId), eq(project.id, id)));
}

/** Delete the project record. The GitHub repo is left untouched. */
export async function deleteProject(userId: string, id: string): Promise<void> {
  await db
    .delete(project)
    .where(and(eq(project.userId, userId), eq(project.id, id)));
}
