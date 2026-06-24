import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { db, schema } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { captureResetLink, isManaged } from "@/lib/reset-capture";

export const auth = betterAuth({
  // On Vercel, fall back to the deployment URL so a 1-click deploy needs no
  // BETTER_AUTH_URL paste. Locally, set BETTER_AUTH_URL in .env.local.
  baseURL:
    process.env.BETTER_AUTH_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined),
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
      rateLimit: schema.rateLimit,
    },
  }),
  emailAndPassword: {
    enabled: true,
    // Invite-only: no public sign-up. Admins create users; the first admin
    // is seeded via the seed:admin script.
    disableSignUp: true,
    // 7 days — long enough to double as the invite (set-password) window.
    resetPasswordTokenExpiresIn: 60 * 60 * 24 * 7,
    sendResetPassword: async ({ user, url }) => {
      // Capture for the invite action (copyable link + custom invite email).
      captureResetLink(user.email, url);
      // Invite-managed emails get a richer email (with note) from the invite
      // action — skip the generic one to avoid double-sending.
      if (isManaged(user.email)) return;
      await sendEmail({
        to: user.email,
        subject: "Reset your Knack password",
        html: `<p><a href="${url}">Reset your password</a> to get back into Knack.</p>
<p>If you didn't request this, you can ignore this email.</p>`,
      });
    },
  },
  session: {
    // read the session from a signed cookie instead of the DB on most
    // requests — avoids a Neon round-trip on every navigation
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  user: {
    // IANA timezone, settable by the user from Settings (via authClient.updateUser).
    // Used to render the date in the agent system prompt in the user's local time.
    additionalFields: {
      timezone: {
        type: "string",
        required: false,
        defaultValue: "UTC",
        input: true,
      },
    },
    // let users change their own email from Profile; if their current email is
    // verified, Better Auth emails a confirmation to the new address first.
    changeEmail: {
      enabled: true,
      sendChangeEmailVerification: async ({
        user,
        newEmail,
        url,
      }: {
        user: { email: string };
        newEmail: string;
        url: string;
      }) => {
        await sendEmail({
          to: user.email,
          subject: "Confirm your new Knack email",
          html: `<p>Confirm changing your email to ${newEmail}:</p>
<p><a href="${url}">Confirm email change</a></p>`,
        });
      },
    },
  },
  // Protect the anonymous attack surface (brute-force / signup spam). Applies
  // in production; disabled in dev by Better Auth. Stored in Postgres.
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 10, max: 5 },
      "/sign-up/email": { window: 60, max: 5 },
      "/request-password-reset": { window: 60, max: 3 },
      "/reset-password": { window: 60, max: 5 },
    },
  },
  // social providers can be added here later (GitHub, Google, …)
  // admin() must come before nextCookies(), which must be last.
  plugins: [
    admin({ defaultRole: "user", adminRoles: ["admin"] }),
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
