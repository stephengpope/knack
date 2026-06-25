import "server-only";
import type { UIMessage } from "ai";
import { REPO_DIR } from "@/lib/prompt/paths";
import type { SandboxBox } from "@/lib/sandbox/types";
import { readAttachment, deleteAttachment } from "./blob";
import { classifyKind, isAttachmentPart } from "./types";

const ATT_DIR = `${REPO_DIR}/.attachments`;

export function messageHasAttachments(message: UIMessage): boolean {
  return (message.parts ?? []).some(isAttachmentPart);
}

export function anyAttachments(messages: UIMessage[]): boolean {
  return messages.some(messageHasAttachments);
}

/** Idempotently ensure `.attachments/` exists with its self-ignoring `.gitignore`
 *  (covers projects created before the template seeded one — without it `git add
 *  -A` would commit the uploaded files). */
async function ensureDir(box: SandboxBox): Promise<void> {
  await box.run("bash", [
    "-c",
    `mkdir -p ${ATT_DIR} && [ -f ${ATT_DIR}/.gitignore ] || printf '*\\n!.gitignore\\n' > ${ATT_DIR}/.gitignore`,
  ]);
}

/**
 * Pull each freshly-uploaded attachment from Blob into the sandbox `.attachments/`
 * (so the agent can operate on any of them), then finalize the stored part:
 *  - text  → inline `textContent`, delete the (transient) blob, drop `pathname`
 *  - image/pdf → keep the blob (durable, for signed-URL rendering + model re-inline)
 *  - binary → delete the (transient) blob, drop `pathname`
 * Mutates `message.parts` in place. Returns true if anything changed (caller re-saves).
 */
export async function materializeAttachments(
  box: SandboxBox,
  message: UIMessage,
): Promise<boolean> {
  const parts = message.parts ?? [];
  if (!parts.some(isAttachmentPart)) return false;
  await ensureDir(box);

  let changed = false;
  for (const p of parts) {
    if (!isAttachmentPart(p)) continue;
    const d = p.data;
    if (!d.pathname) continue; // already materialized on a prior turn

    let bytes: Buffer;
    try {
      bytes = await readAttachment(d.pathname);
    } catch {
      continue; // blob already gone — nothing to do
    }

    const safe = d.filename.replace(/[\\/]+/g, "_");
    d.filename = safe;
    d.kind = classifyKind(d.mediaType, safe);
    await box.writeFile(`${ATT_DIR}/${safe}`, bytes);

    if (d.kind === "text") d.textContent = bytes.toString("utf8");
    if (d.kind === "text" || d.kind === "binary") {
      await deleteAttachment(d.pathname).catch(() => {});
      delete d.pathname; // non-renderable: blob is transient
    }
    changed = true;
  }
  return changed;
}
