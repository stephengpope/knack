import "server-only";

/**
 * Bridges Better Auth's `sendResetPassword` callback to the invite server
 * action. requestPasswordReset() awaits sendResetPassword before returning,
 * so within a single server invocation the action can read back the generated
 * link by email.
 *
 * - `captureResetLink` / `takeResetLink`: surface the link to the invite action
 *   (used for the copyable fallback, and to compose our own invite email).
 * - `markManaged` / `isManaged`: when set, sendResetPassword skips its generic
 *   email — the invite action sends a richer one (with the personal note).
 */
const links = new Map<string, string>();
const managed = new Set<string>();

export function captureResetLink(email: string, url: string) {
  links.set(email.toLowerCase(), url);
}

export function takeResetLink(email: string): string | undefined {
  const key = email.toLowerCase();
  const url = links.get(key);
  links.delete(key);
  managed.delete(key);
  return url;
}

export function markManaged(email: string) {
  managed.add(email.toLowerCase());
}

export function isManaged(email: string): boolean {
  return managed.has(email.toLowerCase());
}
