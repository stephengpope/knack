import "server-only";
import type { UIMessage } from "ai";
import { signGetUrls } from "./blob";
import { isAttachmentPart } from "./types";

/**
 * Inject short-lived signed GET URLs into renderable (image/pdf) attachment parts
 * so the browser can fetch them directly from the Blob CDN. Call this only on the
 * path to the CLIENT (the chat page) — NOT on the history fed to the model, which
 * reads bytes server-side. The signing token never leaves the server; only the
 * finished URLs are attached (transient, never persisted).
 */
export async function signMessageAttachments(
  messages: UIMessage[],
): Promise<UIMessage[]> {
  const pathnames: string[] = [];
  for (const m of messages) {
    for (const p of m.parts ?? []) {
      if (
        isAttachmentPart(p) &&
        p.data.pathname &&
        (p.data.kind === "image" || p.data.kind === "pdf")
      ) {
        pathnames.push(p.data.pathname);
      }
    }
  }
  if (pathnames.length === 0) return messages;

  let urls: Record<string, string>;
  try {
    urls = await signGetUrls(pathnames);
  } catch {
    return messages; // signing failed — render falls back to a chip
  }

  return messages.map((m) => ({
    ...m,
    parts: (m.parts ?? []).map((p) =>
      isAttachmentPart(p) && p.data.pathname && urls[p.data.pathname]
        ? { ...p, data: { ...p.data, url: urls[p.data.pathname] } }
        : p,
    ),
  }));
}
