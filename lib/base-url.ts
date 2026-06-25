import "server-only";

/**
 * The server's public base URL, resolved the same way for everything that needs
 * an absolute origin (Better Auth, the Telegram webhook, etc.) so there's one
 * source of truth — not a separate env var per feature.
 *
 * On Vercel, falls back to the project's stable production domain so a 1-click
 * deploy needs no `BETTER_AUTH_URL` paste. Locally, set `BETTER_AUTH_URL`.
 */
export function serverBaseUrl(): string | undefined {
  return (
    process.env.BETTER_AUTH_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined)
  );
}
