import "server-only";
import nodemailer from "nodemailer";
import { getSmtpConfig, type SmtpConfig } from "@/lib/settings";

/**
 * Generic SMTP email via Nodemailer. Config is admin-managed and stored in the
 * `app_settings` row (see lib/settings.ts) — there are no email env vars.
 *
 * `emailConfigured()` is the master switch: when SMTP is disabled or incomplete
 * it returns false, and callers fall back (forgot-password link hidden, invites
 * surface a copyable link, email changes apply without confirmation).
 */

function transport(cfg: SmtpConfig) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure, // true = implicit TLS (465); false = STARTTLS (587)
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  });
}

/** True when SMTP is enabled and has the minimum config to send. */
export async function emailConfigured(): Promise<boolean> {
  const cfg = await getSmtpConfig();
  return Boolean(cfg);
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  const cfg = await getSmtpConfig();
  if (!cfg) return false; // no-op when email is off — callers handle the fallback
  try {
    await transport(cfg).sendMail({
      from: cfg.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify SMTP credentials without sending — opens the connection and runs the
 * SMTP handshake/auth. Powers the admin "Test" button. Returns an error message
 * on failure, or null on success. Takes an explicit config so the admin can test
 * before saving.
 */
export async function verifySmtp(cfg: SmtpConfig): Promise<string | null> {
  try {
    await transport(cfg).verify();
    return null;
  } catch (e) {
    return (e as Error).message || "Connection failed";
  }
}
