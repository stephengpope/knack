import "server-only";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import {
  del,
  get,
  issueSignedToken,
  list,
  presignUrl,
  put,
  type IssuedSignedToken,
} from "@vercel/blob";

// A stored attachment, addressed by its private-store pathname.
export type AttachmentRef = {
  pathname: string;
  filename: string;
  mediaType: string;
  size: number;
};

// Blobs are keyed `chat/${chatId}/${uuid}-${safeName}`.
function chatPrefix(chatId: string): string {
  return `chat/${chatId}/`;
}

// Drop path separators so a filename can't escape its chat prefix.
function sanitizeFilename(filename: string): string {
  return filename.replace(/[/\\]/g, "_");
}

export async function putAttachment(
  chatId: string,
  filename: string,
  mediaType: string,
  data: Buffer,
): Promise<AttachmentRef> {
  const safeName = sanitizeFilename(filename);
  const pathname = `${chatPrefix(chatId)}${randomUUID()}-${safeName}`;
  const result = await put(pathname, data, {
    access: "private",
    contentType: mediaType,
    addRandomSuffix: false,
  });
  return {
    pathname: result.pathname,
    filename: safeName,
    mediaType,
    size: data.length,
  };
}

export async function readAttachment(pathname: string): Promise<Buffer> {
  const result = await get(pathname, { access: "private" });
  if (!result) {
    throw new Error(`readAttachment: not found: ${pathname}`);
  }
  if (result.statusCode !== 200) {
    throw new Error(
      `readAttachment: unexpected status ${result.statusCode} for ${pathname}`,
    );
  }
  const node = Readable.fromWeb(result.stream as Parameters<typeof Readable.fromWeb>[0]);
  const chunks: Buffer[] = [];
  for await (const chunk of node) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// Module-level delegation-token cache. A token scoped to `*`/`get` is reused
// across all signing calls until it nears expiry, so signing stays HMAC-only.
const TOKEN_TTL_MS = 3600_000;
const REFRESH_WINDOW_MS = 5 * 60_000;
let cachedToken: { token: IssuedSignedToken; validUntil: number } | null = null;

async function getSigningToken(): Promise<IssuedSignedToken> {
  const now = Date.now();
  if (cachedToken && cachedToken.validUntil - now > REFRESH_WINDOW_MS) {
    return cachedToken.token;
  }
  const token = await issueSignedToken({
    operations: ["get"],
    pathname: "*",
    validUntil: now + TOKEN_TTL_MS,
  });
  cachedToken = { token, validUntil: token.validUntil };
  return token;
}

export async function signGetUrls(
  pathnames: string[],
): Promise<Record<string, string>> {
  const token = await getSigningToken();
  const entries = await Promise.all(
    pathnames.map(async (pathname) => {
      const { presignedUrl } = await presignUrl(token, {
        operation: "get",
        pathname,
        access: "private",
      });
      return [pathname, presignedUrl] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export async function deleteChatBlobs(chatId: string): Promise<number> {
  const prefix = chatPrefix(chatId);
  let cursor: string | undefined;
  let deleted = 0;
  do {
    const page = await list({ prefix, cursor });
    const urls = page.blobs.map((b) => b.url);
    if (urls.length > 0) {
      await del(urls);
      deleted += urls.length;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}

export async function deleteAttachment(pathname: string): Promise<void> {
  await del(pathname);
}
