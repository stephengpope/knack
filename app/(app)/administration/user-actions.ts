"use server";

import { randomBytes } from "crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/session";
import { takeResetLink, markManaged } from "@/lib/reset-capture";
import { sendEmail } from "@/lib/email";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
};

function randomPassword() {
  return randomBytes(24).toString("base64url");
}

export async function listUsersAction(): Promise<UserRow[]> {
  await requireAdmin();
  const res = await auth.api.listUsers({
    query: { limit: 200, sortBy: "createdAt", sortDirection: "asc" },
    headers: await headers(),
  });
  return (res.users ?? []).map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: (u.role as string) ?? "user",
  }));
}

export type InviteResult = {
  email: string;
  link: string | null;
  emailed: boolean;
  error?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function inviteEmailHtml(url: string) {
  return `<p>You've been invited to Knack.</p>
<p><a href="${url}">Set your password</a> to finish setting up your account.</p>
<p>If you didn't expect this, you can ignore this email.</p>`;
}

async function inviteOne(
  email: string,
  role: "user" | "admin",
  headersList: Awaited<ReturnType<typeof headers>>,
): Promise<InviteResult> {
  try {
    await auth.api.createUser({
      body: {
        email,
        name: email.split("@")[0],
        password: randomPassword(),
        role,
      },
      headers: headersList,
    });

    // Suppress Better Auth's generic email; we send a richer invite below.
    markManaged(email);
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: "/accept-invite" },
      headers: headersList,
    });

    let link = takeResetLink(email) ?? null;
    if (link) {
      link +=
        (link.includes("?") ? "&" : "?") + `email=${encodeURIComponent(email)}`;
    }

    // sendEmail() no-ops (returns false) when SMTP is off, so no guard needed —
    // the link is always returned for the admin to copy.
    let emailed = false;
    if (link) {
      emailed = await sendEmail({
        to: email,
        subject: "You're invited to my Knack",
        html: inviteEmailHtml(link),
      });
    }
    return { email, link, emailed };
  } catch (e) {
    const msg = (e as Error).message ?? "Couldn't invite";
    return {
      email,
      link: null,
      emailed: false,
      error: /exist|unique|already/i.test(msg) ? "Already a member" : msg,
    };
  }
}

/**
 * Invite one or more users by email. Each gets a set-password link, emailed
 * when SMTP is configured and always returned for the admin to copy.
 */
export async function inviteUsersAction(input: {
  emails: string[];
  role: "user" | "admin";
}): Promise<InviteResult[]> {
  await requireAdmin();
  const h = await headers();
  const seen = new Set<string>();
  const emails = input.emails
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e && !seen.has(e) && (seen.add(e), true));

  const results: InviteResult[] = [];
  for (const email of emails) {
    if (!EMAIL_RE.test(email)) {
      results.push({ email, link: null, emailed: false, error: "Invalid email" });
      continue;
    }
    results.push(await inviteOne(email, input.role, h));
  }
  revalidatePath("/administration");
  return results;
}

export async function setUserRoleAction(userId: string, role: "user" | "admin") {
  await requireAdmin();
  await auth.api.setRole({
    body: { userId, role },
    headers: await headers(),
  });
  revalidatePath("/administration");
}

export async function removeUserAction(userId: string) {
  const admin = await requireAdmin();
  if (userId === admin.id) throw new Error("You can't remove yourself");
  await auth.api.removeUser({
    body: { userId },
    headers: await headers(),
  });
  revalidatePath("/administration");
}
