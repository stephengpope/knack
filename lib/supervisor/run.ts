import "server-only";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { UIMessage } from "ai";
import { db } from "@/lib/db";
import { chat } from "@/lib/db/schema";
import { loadMessages } from "@/lib/chats";
import { getProject } from "@/lib/projects";
import { getGithubAuth } from "@/lib/github-account";
import { getAppSettings } from "@/lib/settings";
import { runAgentTurn, drainStream } from "@/lib/agent/run-turn";
import { logUsage, runTokens } from "@/lib/usage";
import { claimCard, releaseLease } from "@/lib/supervisor/select";
import { getOrCreateSupervisorChat } from "@/lib/supervisor/chat";
import { runSupervisorTurn } from "@/lib/supervisor/turn";
import { renderRoundPrompt, type CardContract } from "@/lib/supervisor/prompt";

async function block(chatId: string, reason: string) {
  await db
    .update(chat)
    .set({
      kanbanStatus: "blocked",
      blockedReason: reason,
      activeRole: "supervisor",
      leaseUntil: null,
    })
    .where(eq(chat.id, chatId));
}

/**
 * One supervisor cycle for a card: claim → ceiling check → tooled review (the
 * supervisor inspects the worker's repo with read-only tools) → act
 * (review / blocked / continue+worker turn). Idempotent under double-dispatch.
 */
export async function runSupervisorCycle(chatId: string): Promise<void> {
  const card = await claimCard(chatId);
  if (!card) return; // not eligible, or another runner claimed it

  const userId = card.userId;
  const settings = await getAppSettings();
  const maxRounds = card.maxRoundsOverride ?? settings.maxRounds;
  const maxTokens = card.maxTokensOverride ?? settings.maxTokensPerCard;
  const runStart = card.runStartedAt ?? new Date();

  // Per-run ceiling: rounds + tokens since this run started.
  const tokens = await runTokens(chatId, runStart);
  if (card.iteration >= maxRounds || tokens >= maxTokens) {
    await block(
      chatId,
      `Budget reached for this run (${card.iteration}/${maxRounds} rounds, ` +
        `${tokens}/${maxTokens} tokens). Move the card back to In Progress to ` +
        `restart with a fresh budget.`,
    );
    return;
  }

  const project = card.projectId
    ? await getProject(userId, card.projectId)
    : null;
  const githubAuth = project ? await getGithubAuth(userId) : null;
  const history = await loadMessages(chatId);

  const contract: CardContract = {
    title: card.title,
    iteration: card.iteration,
    userStory: card.userStory,
    details: card.details,
    acceptanceCriteria: card.acceptanceCriteria ?? [],
    tasks: card.tasks ?? [],
    testCases: card.testCases ?? [],
  };

  // The per-round prompt: the contract + the worker's recent claim (last 3 text
  // messages). Decision rules / loop framing / nextPrompt guidance live in the
  // system prompt; the supervisor verifies real state with its read-only tools.
  const roundPrompt = renderRoundPrompt(contract, history);

  let result;
  try {
    const supervisorChatId = await getOrCreateSupervisorChat(
      userId,
      chatId,
      project,
      githubAuth?.pat ?? null,
    );
    result = await runSupervisorTurn({
      userId,
      supervisorChatId,
      workerChatId: chatId,
      project,
      githubAuth,
      roundPrompt,
    });
  } catch (e) {
    await block(chatId, `Supervisor review failed: ${(e as Error).message}`);
    return;
  }
  await logUsage(chatId, "supervisor", result.modelId, result.usage);

  // Persist any checklist updates the supervisor made (full-list replacement).
  const cu = result.decision.criteriaUpdates;
  const updates: Record<string, unknown> = {};
  if (cu.acceptanceCriteria) updates.acceptanceCriteria = cu.acceptanceCriteria;
  if (cu.tasks) updates.tasks = cu.tasks;
  if (cu.testCases) updates.testCases = cu.testCases;
  if (Object.keys(updates).length) {
    await db.update(chat).set(updates).where(eq(chat.id, chatId));
  }

  if (result.decision.verdict === "review") {
    await db
      .update(chat)
      .set({ kanbanStatus: "review", activeRole: "supervisor", leaseUntil: null })
      .where(eq(chat.id, chatId));
    return;
  }
  if (result.decision.verdict === "blocked") {
    await block(chatId, result.decision.reason || "Supervisor blocked the card.");
    return;
  }

  // continue → post the supervisor's prompt to the WORKER chat and run a worker
  // turn. runAgentTurn does the db-first save itself (Phase 0).
  const next =
    result.decision.nextPrompt?.trim() ||
    "Continue with the next step toward the acceptance criteria.";
  const message: UIMessage = {
    id: nanoid(),
    role: "user",
    parts: [{ type: "text", text: next }],
  };
  await db
    .update(chat)
    .set({ activeRole: "worker", iteration: card.iteration + 1 })
    .where(eq(chat.id, chatId));

  try {
    const turn = await runAgentTurn({ userId, chatId, message });
    await drainStream(turn.stream as ReadableStream<unknown>);
    if (turn.sync) await turn.sync();
    const usage = await turn.usage;
    await logUsage(chatId, "worker", null, usage);
  } catch (e) {
    await block(chatId, `Worker turn failed: ${(e as Error).message}`);
    return;
  }

  await releaseLease(chatId);
}
