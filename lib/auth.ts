import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db, schema } from "@/lib/db";

export const auth = betterAuth({
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
  },
  session: {
    // read the session from a signed cookie instead of the DB on most
    // requests — avoids a Neon round-trip on every navigation
    cookieCache: { enabled: true, maxAge: 5 * 60 },
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
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
