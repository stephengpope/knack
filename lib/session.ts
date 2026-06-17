import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

/** Server-side current session (deduped per request). */
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

/** Current user, or redirect to /login. Use in protected pages. */
export async function requireUser() {
  const session = await getSession();
  if (!session?.user) redirect("/login");
  return session.user;
}

/** True when the current user is an admin. */
export function isAdmin(user: { role?: string | null } | null | undefined) {
  return user?.role === "admin";
}

/** Current admin user, or redirect. Use in admin-only pages/actions. */
export async function requireAdmin() {
  const user = await requireUser();
  if (!isAdmin(user)) redirect("/");
  return user;
}
