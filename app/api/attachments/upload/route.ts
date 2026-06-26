import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { chatOwnerId } from "@/lib/chats";

/**
 * Client-direct attachment upload to the PRIVATE Blob store. The browser uploads
 * straight to Blob (bypassing the 4.5 MB function body limit); this route only
 * mints a short-lived, scoped client token. Auth + ownership are enforced in
 * `onBeforeGenerateToken`: the caller must own the chat, and the pathname must be
 * within that chat's prefix (`chat/{chatId}/…`).
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const session = await getSession();
        if (!session?.user) throw new Error("Unauthorized");
        const userId = session.user.id;

        let chatId: string | undefined;
        try {
          chatId = clientPayload ? JSON.parse(clientPayload)?.chatId : undefined;
        } catch {
          // fall through to the missing-chatId error
        }
        if (!chatId) throw new Error("Missing chatId");
        if (!pathname.startsWith(`chat/${chatId}/`)) {
          throw new Error("Invalid attachment path");
        }
        // A new chat's row is created only on its first message — which is sent
        // AFTER this upload. So allow when the chat doesn't exist yet; only
        // reject if it exists and belongs to someone else.
        const owner = await chatOwnerId(chatId);
        if (owner && owner !== userId) throw new Error("Unknown chat");

        return {
          access: "private",
          addRandomSuffix: false,
          tokenPayload: JSON.stringify({ chatId, userId }),
        };
      },
      onUploadCompleted: async () => {
        // Nothing to persist here — the message carries the pathname, and
        // run-turn materializes it. (Required hook; intentionally a no-op.)
      },
    });
    return NextResponse.json(json);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: m }, {
      status: m === "Unauthorized" ? 401 : 400,
    });
  }
}
