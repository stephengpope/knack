import "server-only";
import type { UIMessage } from "ai";
import { readAttachment } from "./blob";
import { isAttachmentPart, type AttachmentData } from "./types";

// Which inline media a provider's AI SDK conversion ACCEPTS (verified from each
// @ai-sdk/* convert-to-*-messages source). Audio is intentionally not inlined in
// v1 (kept as a sandbox note). Two providers SILENTLY DROP unsupported parts
// (google, deepseek) — the map is what prevents an image from vanishing with no
// error; the rest throw and are caught by the run-turn backstop.
type InlineCaps = { image: boolean; pdf: boolean };

const CAPS: Record<string, InlineCaps> = {
  anthropic: { image: true, pdf: true },
  openai: { image: true, pdf: true },
  "openai-compatible": { image: true, pdf: true },
  mistral: { image: true, pdf: true },
  google: { image: true, pdf: false },
  xai: { image: true, pdf: false },
  deepseek: { image: false, pdf: false },
};

/** Resolve the active provider's inline capability from the live connection mode
 *  and model id. `compatible` mode is its own conversion path; otherwise the
 *  provider is the model-id prefix (`anthropic/…`). Unknown → conservative
 *  (images only). */
export function inlineCapsFor(
  connectionMode: string,
  modelId: string,
): InlineCaps {
  const provider =
    connectionMode === "compatible"
      ? "openai-compatible"
      : (modelId.split("/")[0] || "").toLowerCase();
  return CAPS[provider] ?? { image: true, pdf: false };
}

function fenced(d: AttachmentData): string {
  return `\`${d.filename}\` (saved to .attachments/${d.filename}):\n\`\`\`\n${d.textContent ?? ""}\n\`\`\``;
}
function savedNote(d: AttachmentData, extra?: string): string {
  return `[Attachment: ${d.filename} (${d.mediaType}) saved to .attachments/${d.filename}${extra ? `; ${extra}` : ""}]`;
}
function blindNote(d: AttachmentData): string {
  return `[${d.kind === "pdf" ? "PDF" : "Image"} ${d.filename} attached, but the current model can't view it — it's saved to .attachments/${d.filename}]`;
}

async function inlineFilePart(d: AttachmentData) {
  if (!d.pathname) return null;
  const bytes = await readAttachment(d.pathname);
  return {
    type: "file" as const,
    mediaType: d.mediaType,
    filename: d.filename,
    url: `data:${d.mediaType};base64,${bytes.toString("base64")}`,
  };
}

/**
 * Rewrite a stored UIMessage into a MODEL-SAFE one: image/pdf inlined only if the
 * active provider accepts them (else a note), text files inlined as fenced text,
 * binaries as a note. Reads renderable bytes from Blob in parallel. The stored /
 * displayed messages are left untouched — this output is only fed to the model.
 */
export async function prepareForModel(
  messages: UIMessage[],
  caps: InlineCaps,
): Promise<UIMessage[]> {
  return Promise.all(
    messages.map(async (m) => {
      const parts = await Promise.all(
        (m.parts ?? []).map(async (p) => {
          if (!isAttachmentPart(p)) return [p];
          const d = p.data;
          if (d.kind === "text") return [{ type: "text" as const, text: fenced(d) }];
          if (d.kind === "image" || d.kind === "pdf") {
            const allowed = d.kind === "image" ? caps.image : caps.pdf;
            if (allowed) {
              const fp = await inlineFilePart(d);
              if (fp) return [fp];
            }
            return [{ type: "text" as const, text: blindNote(d) }];
          }
          return [{ type: "text" as const, text: savedNote(d) }];
        }),
      );
      return { ...m, parts: parts.flat() } as UIMessage;
    }),
  );
}

/** True if the error is a provider "unsupported media type" rejection — the
 *  signal the run-turn backstop uses to demote a part to a note and retry. */
export function isUnsupportedMediaError(e: unknown): boolean {
  const name = (e as { name?: string })?.name ?? "";
  const msg = (e as { message?: string })?.message ?? "";
  return name === "AI_UnsupportedFunctionalityError" || /unsupported functionality|media type/i.test(msg);
}
