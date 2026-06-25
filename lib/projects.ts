import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { project, type Project } from "@/lib/db/schema";
import { getGithubAuth } from "@/lib/github-account";
import { createRepo, putFile, getRepo } from "@/lib/github";
import { readTemplate } from "@/lib/prompt/files";

export type ProjectSummary = {
  id: string;
  name: string;
  repoFullName: string;
  htmlUrl: string;
  isDefault: boolean;
  active: boolean;
};

function toSummary(p: Project): ProjectSummary {
  return {
    id: p.id,
    name: p.name,
    repoFullName: p.repoFullName,
    htmlUrl: p.htmlUrl,
    isDefault: p.isDefault,
    active: p.active,
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
 * Look up a project by id WITHOUT a userId. Used by the cron dispatcher, which
 * has no session — it derives the owning user from `project.userId`. Never
 * expose this to a user-facing path; all interactive lookups must scope by user.
 */
export async function getProjectById(id: string): Promise<Project | null> {
  const [row] = await db
    .select()
    .from(project)
    .where(eq(project.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * All active projects across all users — the cron tick's working set. System
 * query (no user scope); each row carries its own `userId` for PAT resolution.
 */
export async function listActiveProjects(): Promise<Project[]> {
  return db.select().from(project).where(eq(project.active, true));
}

/** A user's active projects as full rows (the cron view needs repo coordinates). */
export async function listActiveProjectsForUser(
  userId: string,
): Promise<Project[]> {
  return db
    .select()
    .from(project)
    .where(and(eq(project.userId, userId), eq(project.active, true)))
    .orderBy(desc(project.createdAt));
}

/** Toggle a project active/inactive. Deactivating the default is rejected —
 *  the caller must reassign the default first. */
export async function setProjectActive(
  userId: string,
  id: string,
  active: boolean,
): Promise<void> {
  if (!active) {
    const p = await getProject(userId, id);
    if (p?.isDefault) {
      throw new Error(
        "Can't deactivate the default project. Make another project the default first.",
      );
    }
  }
  await db
    .update(project)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(project.userId, userId), eq(project.id, id)));
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
    active: true,
  };
}

/**
 * Link an EXISTING GitHub repo as a project. Unlike createProject, this creates
 * nothing on GitHub and seeds no template files — it just validates the repo
 * (existence + push access) and records the row. The repo is cloned into the
 * sandbox on the first chat message, same as any project. The first project
 * becomes the default.
 */
export async function addExistingProject(
  userId: string,
  input: { owner: string; repo: string; name?: string },
): Promise<ProjectSummary> {
  const auth = await getGithubAuth(userId);
  if (!auth) throw new Error("Connect a GitHub account first.");

  const repo = await getRepo(auth.pat, input.owner, input.repo);

  // Don't link the same repo twice for one user.
  const [dup] = await db
    .select({ id: project.id })
    .from(project)
    .where(
      and(eq(project.userId, userId), eq(project.repoFullName, repo.fullName)),
    )
    .limit(1);
  if (dup) throw new Error(`${repo.fullName} is already one of your projects.`);

  const existing = await db
    .select({ id: project.id })
    .from(project)
    .where(eq(project.userId, userId))
    .limit(1);
  const isDefault = existing.length === 0;

  const name = input.name?.trim() || repo.repo;
  const id = nanoid();
  await db.insert(project).values({
    id,
    userId,
    name,
    repoOwner: repo.owner,
    repoName: repo.repo,
    repoFullName: repo.fullName,
    defaultBranch: repo.defaultBranch,
    htmlUrl: repo.htmlUrl,
    isDefault,
  });

  return {
    id,
    name,
    repoFullName: repo.fullName,
    htmlUrl: repo.htmlUrl,
    isDefault,
    active: true,
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
