import "server-only";

/**
 * Minimal Resend client over the REST API (no package dependency).
 * Configured via Vercel Marketplace → injects RESEND_API_KEY.
 * RESEND_FROM is the verified sender, e.g. "Knack <noreply@yourdomain.com>".
 *
 * Returns false (no-op) when not configured — callers fall back to the
 * copyable link shown in the UI.
 */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  if (!emailConfigured()) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
