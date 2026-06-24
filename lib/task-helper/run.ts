import "server-only";
import { generateObject, generateText } from "ai";
import { z } from "zod";
import { resolveAgentModel } from "@/lib/llm";
import {
  TASK_HELPER_PROMPT,
  TASK_HELPER_STRUCTURE_PROMPT,
  renderTaskHelperPrompt,
} from "@/lib/task-helper/prompt";
import type { TaskHelperInput, TaskHelperResult } from "@/lib/task-helper/types";

const ticketDraftSchema = z.object({
  title: z.string(),
  userStory: z.string(),
  details: z.string(),
  acceptanceCriteria: z.array(z.string()),
});

const taskHelperSchema = z.object({
  done: z.boolean(),
  questions: z.array(z.string()),
  ticketDraft: ticketDraftSchema.nullable(),
});

/**
 * One Task Helper round. No sandbox, no persistence: a single structured call
 * that returns either clarifying questions or the finalized ticket. The dialog
 * accumulates the Q&A and calls this each round.
 */
export async function runTaskHelperTurn(
  input: TaskHelperInput,
): Promise<TaskHelperResult> {
  const { modelId, model, providerOptions } = await resolveAgentModel();

  // Pass 1 — free-form prose. No schema is forced, so the model generates
  // naturally (forcing a schema during generation makes this model loop and
  // produce garbage). It writes either its questions or the finalized ticket.
  const reply = await generateText({
    model,
    providerOptions,
    system: TASK_HELPER_PROMPT,
    prompt: renderTaskHelperPrompt(input),
  });

  // Pass 2 — transcribe that prose into the schema. The content is already
  // decided, so the model copies rather than generates. Anthropic forbids forced
  // tool-use (object mode) while extended thinking is on, so disable it there.
  let opts = providerOptions as Record<string, unknown> | undefined;
  if (modelId.startsWith("anthropic/")) {
    const prev = (opts?.anthropic ?? {}) as Record<string, unknown>;
    opts = { ...(opts ?? {}), anthropic: { ...prev, thinking: { type: "disabled" } } };
  }

  const { object } = await generateObject({
    model,
    providerOptions: opts as typeof providerOptions,
    schema: taskHelperSchema,
    system: TASK_HELPER_STRUCTURE_PROMPT,
    prompt: `${reply.text}\n\nConvert the reply above into the structured object.`,
  });

  // Guard the contract: a draft only counts when done; questions only when not.
  return {
    done: object.done,
    questions: object.done ? [] : object.questions,
    ticketDraft: object.done ? object.ticketDraft : null,
  };
}
