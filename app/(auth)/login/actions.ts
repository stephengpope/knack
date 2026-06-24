"use server";

import { nanoid } from "nanoid";
import { hashPassword } from "better-auth/crypto";
import { db, schema } from "@/lib/db";

/**
 * Bootstrap the first admin on a fresh deployment.
 *
 * Only succeeds while there are zero users — the `/login` page shows the
 * create-admin form in that state, then reverts to the normal (invite-only)
 * sign-in once a user exists. The zero-user guard is re-checked here so the
 * action can't be used to self-register after setup.
 */
export async function createFirstAdmin(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<{ ok: true } | { error: string }> {
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  if (!email || !password || password.length < 8) {
    return { error: "Enter an email and a password of at least 8 characters." };
  }

  const [existing] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .limit(1);
  if (existing) return { error: "Setup is already complete — sign in instead." };

  const now = new Date();
  const userId = nanoid();
  const hashed = await hashPassword(password);

  await db.insert(schema.user).values({
    id: userId,
    name: input.name?.trim() || email.split("@")[0],
    email,
    emailVerified: true,
    role: "admin",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.account).values({
    id: nanoid(),
    accountId: userId,
    providerId: "credential",
    userId,
    password: hashed,
    createdAt: now,
    updatedAt: now,
  });

  return { ok: true };
}
