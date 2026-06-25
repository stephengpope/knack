// Shared attachment types. An attachment is stored in a message as a custom
// `data-attachment` UI part. The model never sees this part directly — at turn
// time `prepareForModel` (model.ts) rewrites it into a model-safe part (an image
// file part, a fenced text block, or a one-line note). What renders in the chat
// (image thumbnail / file chip) comes straight from this stored part.

export type AttachmentKind = "image" | "pdf" | "text" | "binary";

export type AttachmentData = {
  /** Blob pathname (`chat/{chatId}/{uuid}-{name}`). Present for renderables kept
   *  in Blob (image/pdf). Absent for text/binary (their blob is deleted after the
   *  bytes land in the sandbox). */
  pathname?: string;
  filename: string;
  mediaType: string;
  size: number;
  kind: AttachmentKind;
  /** For text files: the decoded contents, inlined to the model and kept for the
   *  UI. Small by nature; lives in Postgres. */
  textContent?: string;
  /** TRANSIENT — a short-lived signed GET URL injected at load time for rendering.
   *  Never persisted (the DB row only has `pathname`). */
  url?: string;
};

/** The custom UI message part. AI SDK data parts are `data-<name>`. */
export type AttachmentPart = {
  type: "data-attachment";
  id?: string;
  data: AttachmentData;
};

export function isAttachmentPart(p: unknown): p is AttachmentPart {
  return (
    typeof p === "object" &&
    p !== null &&
    (p as { type?: unknown }).type === "data-attachment"
  );
}

const TEXT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|xml|html?|css|scss|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|c|h|cpp|cc|hpp|cs|php|sh|bash|zsh|sql|toml|ini|cfg|conf|env|log|gitignore|dockerfile)$/i;

/** Classify a file by media type (falling back to filename extension). */
export function classifyKind(mediaType: string, filename: string): AttachmentKind {
  const mt = (mediaType || "").toLowerCase();
  if (mt.startsWith("image/")) return "image";
  if (mt === "application/pdf") return "pdf";
  if (
    mt.startsWith("text/") ||
    /^application\/(json|xml|x-yaml|yaml|javascript|x-sh|x-www-form-urlencoded)/.test(mt) ||
    TEXT_EXT.test(filename)
  ) {
    return "text";
  }
  return "binary";
}
