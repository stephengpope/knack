import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

type DB = ReturnType<typeof create>;

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add a Neon Postgres database (Vercel Storage) " +
        "and set DATABASE_URL.",
    );
  }
  return drizzle(neon(url), { schema, logger: process.env.DB_LOG === "1" });
}

// Lazily initialized so importing this module never throws at build time;
// the connection (and the loud error above) only resolves on first query.
let instance: DB | null = null;
function resolve(): DB {
  return (instance ??= create());
}

export const db = new Proxy({} as DB, {
  get(_target, prop) {
    const real = resolve() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
