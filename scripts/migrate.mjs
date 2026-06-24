/**
 * Apply Drizzle migrations during the Vercel build (and any CI/deploy step).
 *
 * Runs as part of `pnpm build` so a 1-click deploy needs no manual migrate.
 * Idempotent — Drizzle's journal skips already-applied migrations. If
 * DATABASE_URL isn't present yet (e.g. the Neon store hasn't been wired on a
 * very first build), it skips cleanly so the build still succeeds; the next
 * deploy applies them.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.warn(
    "⚠ DATABASE_URL not set — skipping migrations (they'll run on the next deploy).",
  );
  process.exit(0);
}

const db = drizzle(neon(url));
await migrate(db, { migrationsFolder: "./lib/db/migrations" });
console.log("✓ Migrations applied.");
