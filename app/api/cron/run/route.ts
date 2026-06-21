import { after } from "next/server";
import { nanoid } from "nanoid";
import type { UIMessage } from "ai";
import { getProjectById } from "@/lib/projects";
import { getJob } from "@/lib/cron/state";
import { runAgentTurn, drainStream } from "@/lib/agent/run-turn";

export const maxDuration = 300;

/**
 * Cron run worker — executes one scheduled job as an agent turn. Called only by
 * the tick (server-to-server) behind `$CRON_SECRET`. Takes just
 * `{ projectId, jobName }` and re-derives the user from `project.userId` — it
 * never trusts a user id from the body. Returns 202 immediately and runs the
 * turn in the background (no client to stream to: the stream is drained
 * server-side so messages persist), within maxDuration.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { projectId, jobName } = (await req.json()) as {
    projectId?: string;
    jobName?: string;
  };
  if (!projectId || !jobName) {
    return new Response("Missing projectId/jobName", { status: 400 });
  }

  const project = await getProjectById(projectId);
  if (!project || !project.active) {
    return new Response("No such active project", { status: 404 });
  }
  const job = await getJob(projectId, jobName);
  if (!job || !job.enabled) {
    return new Response("No such enabled job", { status: 404 });
  }

  const userId = project.userId; // trust the row, not the caller
  const chatId = nanoid();
  const messages: UIMessage[] = [
    { id: nanoid(), role: "user", parts: [{ type: "text", text: job.prompt }] },
  ];

  let result;
  try {
    result = await runAgentTurn({
      userId,
      chatId,
      messages,
      model: job.model ?? undefined,
      projectId,
      chat: {
        title: job.jobName,
        source: "cron",
        sourceRef: `${projectId}:${jobName}`,
      },
    });
  } catch (e) {
    console.error(`cron run ${projectId}:${jobName} failed to start:`, (e as Error).message);
    return new Response((e as Error).message, { status: 500 });
  }

  const { stream, sync } = result;
  after(async () => {
    try {
      await drainStream(stream as ReadableStream<unknown>);
      if (sync) await sync();
    } catch (e) {
      console.error(`cron run ${projectId}:${jobName} errored:`, (e as Error).message);
    }
  });

  return new Response(null, { status: 202 });
}
