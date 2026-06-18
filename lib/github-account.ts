import "server-only";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { githubAccount, type GithubAccount } from "@/lib/db/schema";
import { encrypt, decrypt } from "@/lib/crypto";
import { verifyPat } from "@/lib/github";

// Masked view for the UI — never includes the PAT.
export type GithubAccountSummary = {
  login: string;
  status: string;
};

export async function getGithubAccount(
  userId: string,
): Promise<GithubAccountSummary | null> {
  const row = await accountRow(userId);
  return row ? { login: row.login, status: row.status } : null;
}

async function accountRow(userId: string): Promise<GithubAccount | null> {
  const [row] = await db
    .select()
    .from(githubAccount)
    .where(eq(githubAccount.userId, userId))
    .limit(1);
  return row ?? null;
}

/** The decrypted PAT and commit identity, for repo operations. Null if none. */
export async function getGithubAuth(
  userId: string,
): Promise<{ pat: string; login: string; githubUserId: number | null } | null> {
  const row = await accountRow(userId);
  if (!row) return null;
  return {
    pat: decrypt(row.encryptedPat),
    login: row.login,
    githubUserId: row.githubUserId,
  };
}

/** Validate a PAT against GitHub, then upsert the single per-user row. */
export async function connectGithub(
  userId: string,
  pat: string,
): Promise<GithubAccountSummary> {
  const account = await verifyPat(pat); // throws on invalid
  const existing = await accountRow(userId);
  const values = {
    encryptedPat: encrypt(pat),
    login: account.login,
    githubUserId: account.id,
    status: "connected" as const,
    updatedAt: new Date(),
  };
  if (existing) {
    await db
      .update(githubAccount)
      .set(values)
      .where(eq(githubAccount.userId, userId));
  } else {
    await db
      .insert(githubAccount)
      .values({ id: nanoid(), userId, ...values });
  }
  return { login: account.login, status: "connected" };
}

export async function disconnectGithub(userId: string): Promise<void> {
  await db.delete(githubAccount).where(eq(githubAccount.userId, userId));
}
