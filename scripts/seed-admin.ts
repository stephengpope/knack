/**
 * Seed the first admin for a fresh deployment.
 *
 *   SEED_ADMIN_EMAIL=you@co.com SEED_ADMIN_PASSWORD=... pnpm seed:admin
 *
 * Creates an admin user (email + password) if no admin exists yet. If a user
 * with that email already exists, it's promoted to admin instead. No-op once
 * an admin is present — safe to run repeatedly.
 */
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { hashPassword } from "better-auth/crypto";
import { user, account } from "../lib/db/schema.ts";

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url) fail("DATABASE_URL is not set");

const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD;
if (!email) fail("SEED_ADMIN_EMAIL is not set");
if (!password || password.length < 8) {
  fail("SEED_ADMIN_PASSWORD must be set and at least 8 characters");
}

const db = drizzle(neon(url!), { schema: { user, account } });

const [existingAdmin] = await db
  .select({ id: user.id, email: user.email })
  .from(user)
  .where(eq(user.role, "admin"))
  .limit(1);

if (existingAdmin) {
  console.log(`✓ Admin already exists (${existingAdmin.email}) — nothing to do.`);
  process.exit(0);
}

// Promote an existing account with this email, if present.
const [existingUser] = await db
  .select({ id: user.id })
  .from(user)
  .where(eq(user.email, email!))
  .limit(1);

if (existingUser) {
  await db
    .update(user)
    .set({ role: "admin", updatedAt: new Date() })
    .where(eq(user.id, existingUser.id));
  console.log(`✓ Promoted existing user ${email} to admin.`);
  process.exit(0);
}

const now = new Date();
const userId = nanoid();
const hashed = await hashPassword(password!);

await db.insert(user).values({
  id: userId,
  name: email!.split("@")[0],
  email: email!,
  emailVerified: true,
  role: "admin",
  createdAt: now,
  updatedAt: now,
});

await db.insert(account).values({
  id: nanoid(),
  accountId: userId,
  providerId: "credential",
  userId,
  password: hashed,
  createdAt: now,
  updatedAt: now,
});

console.log(`✓ Created admin ${email}. Sign in and finish setup.`);
process.exit(0);
