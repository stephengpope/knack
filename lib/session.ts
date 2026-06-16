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
