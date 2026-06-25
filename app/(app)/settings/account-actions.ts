"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/session";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Change the current user's email WITHOUT verification. Used only when SMTP is
 * disabled — there's no way to deliver a confirmation link, so the change applies
 * directly (an accepted risk; see the SMTP settings). When email IS enabled the
 * client uses Better Auth's verified `changeEmail` flow instead.
 *
 * Writes `user.email` directly and marks it unverified. The credential login
 * looks the user up by this email, so sign-in keeps working with the new address.
 */
export async function changeEmailDirectAction(newEmail: string) {
  const user = await requireUser();
  const next = newEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(next)) throw new Error("Enter a valid email address");
  if (next === user.email.toLowerCase()) return;

  const [taken] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, next))
    .limit(1);
  if (taken && taken.id !== user.id) {
    throw new Error("That email is already in use");
  }

  await db
    .update(schema.user)
    .set({ email: next, emailVerified: false, updatedAt: new Date() })
    .where(eq(schema.user.id, user.id));

  // We wrote the email behind Better Auth's back, so its session cookie cache
  // still holds the old copy. Delete just the cache cookie (NOT the session
  // token) — the user stays logged in, and the next request rebuilds the cache
  // from the DB with the new email. Names cover dev + the secure prod prefix.
  const jar = await cookies();
  jar.delete("better-auth.session_data");
  jar.delete("__Secure-better-auth.session_data");

  revalidatePath("/settings");
}
