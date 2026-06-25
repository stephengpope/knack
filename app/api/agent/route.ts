import { createUIMessageStreamResponse, type UIMessage } from "ai";
import { after } from "next/server";
import { getSession } from "@/lib/session";
import { runAgentTurn } from "@/lib/agent/run-turn";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const userId = session.user.id;

  const {
    message,
    id: chatId,
    model: requestedModel,
    projectId: requestedProjectId,
  }: {
    message: UIMessage;
    id: string;
    model?: string;
    projectId?: string | null;
  } = await req.json();

  if (!chatId) return new Response("Missing chat id", { status: 400 });
  if (!message) return new Response("Missing message", { status: 400 });

  let result;
  try {
    result = await runAgentTurn({
      userId,
      chatId,
      message,
      model: requestedModel,
      projectId: requestedProjectId,
    });
  } catch (e) {
    // Model resolution (connection mode / slug) is the only expected throw here.
    return new Response((e as Error).message, { status: 400 });
  }

  // Commit + push the repo after the response finishes streaming, so it never
  // blocks the user's next message.
  if (result.sync) after(result.sync);

  return createUIMessageStreamResponse({ stream: result.stream });
}
