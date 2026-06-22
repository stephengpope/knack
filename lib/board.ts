import "server-only";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { chat } from "@/lib/db/schema";
import type {
  BoardCard,
  CardPatch,
  ChecklistItem,
  KanbanStatus,
  TestCase,
} from "@/lib/board-types";

// A card IS a chat row with a non-null kanbanStatus. The board is the set of
// such rows; queries + mutations for it live here (server-only), wrapped by
// server actions in app/(app)/board/actions.ts. Client-safe types + constants
// live in lib/board-types.ts.
export type {
  BoardCard,
  CardPatch,
  ChecklistItem,
  KanbanStatus,
  TestCase,
} from "@/lib/board-types";

const cardSelect = {
  id: chat.id,
  cardSeq: chat.cardSeq,
  title: chat.title,
  kanbanStatus: chat.kanbanStatus,
  supervisorEnabled: chat.supervisorEnabled,
  userStory: chat.userStory,
  details: chat.details,
  acceptanceCriteria: chat.acceptanceCriteria,
  tasks: chat.tasks,
  testCases: chat.testCases,
  activeRole: chat.activeRole,
  blockedReason: chat.blockedReason,
  iteration: chat.iteration,
  runStartedAt: chat.runStartedAt,
  lastRunAt: chat.lastRunAt,
  leaseUntil: chat.leaseUntil,
  projectId: chat.projectId,
  updatedAt: chat.updatedAt,
};

// The raw row as the query returns it: jsonb columns and kanbanStatus are
// nullable; normalize() fills them in.
type CardRow = Omit<
  BoardCard,
  "kanbanStatus" | "acceptanceCriteria" | "tasks" | "testCases"
> & {
  kanbanStatus: string | null;
  acceptanceCriteria: ChecklistItem[] | null;
  tasks: ChecklistItem[] | null;
  testCases: TestCase[] | null;
};

function normalize(row: CardRow): BoardCard {
  return {
    ...row,
    kanbanStatus: (row.kanbanStatus ?? "todo") as KanbanStatus,
    acceptanceCriteria: row.acceptanceCriteria ?? [],
    tasks: row.tasks ?? [],
    testCases: row.testCases ?? [],
  };
}

export async function listCards(userId: string): Promise<BoardCard[]> {
  const rows = await db
    .select(cardSelect)
    .from(chat)
    .where(and(eq(chat.userId, userId), isNotNull(chat.kanbanStatus)))
    .orderBy(desc(chat.updatedAt));
  return rows.map(normalize);
}

export async function getCard(
  userId: string,
  id: string,
): Promise<BoardCard | null> {
  const [row] = await db
    .select(cardSelect)
    .from(chat)
    .where(and(eq(chat.id, id), eq(chat.userId, userId)))
    .limit(1);
  return row ? normalize(row) : null;
}

export async function createCard(
  userId: string,
  input: { title?: string | null; projectId?: string | null },
): Promise<BoardCard> {
  const [row] = await db
    .insert(chat)
    .values({
      id: nanoid(),
      userId,
      // Leave the title null so the agent's auto-title names it on the first
      // turn (a non-empty default would suppress that). The UI shows a fallback.
      title: input.title?.trim() || null,
      kanbanStatus: "todo",
      projectId: input.projectId ?? null,
      // Only cards draw a number from the sequence; ordinary chats never do.
      cardSeq: sql`nextval('card_seq')`,
      source: "user",
    })
    .returning(cardSelect);
  return normalize(row);
}

export async function updateCard(
  userId: string,
  id: string,
  patch: CardPatch,
): Promise<void> {
  const set: Record<string, unknown> = { ...patch, updatedAt: new Date() };
  // Moving a card INTO in_progress (re)starts a supervisor run: reset the
  // per-run budget window so a previously-blocked card can proceed again.
  if (patch.kanbanStatus === "in_progress") {
    set.iteration = 0;
    set.runStartedAt = new Date();
    set.blockedReason = null;
  }
  await db
    .update(chat)
    .set(set)
    .where(and(eq(chat.id, id), eq(chat.userId, userId)));
}

export async function removeFromBoard(
  userId: string,
  id: string,
): Promise<void> {
  await db
    .update(chat)
    .set({ kanbanStatus: null, supervisorEnabled: false })
    .where(and(eq(chat.id, id), eq(chat.userId, userId)));
}

/**
 * Toggle autonomy. Enabling on a plain chat promotes it to a card: it lands in
 * `todo` and draws a card number if it doesn't have one. Disabling leaves the
 * card on the board (just no autonomous runs).
 */
export async function setSupervise(
  userId: string,
  id: string,
  enabled: boolean,
): Promise<void> {
  // Read the RAW status (getCard normalizes null → "todo", which would hide
  // whether this chat is already a card).
  const [row] = await db
    .select({ kanbanStatus: chat.kanbanStatus, cardSeq: chat.cardSeq })
    .from(chat)
    .where(and(eq(chat.id, id), eq(chat.userId, userId)))
    .limit(1);
  if (!row) return;
  const set: Record<string, unknown> = {
    supervisorEnabled: enabled,
    updatedAt: new Date(),
  };
  if (enabled && !row.kanbanStatus) set.kanbanStatus = "todo";
  if (enabled && row.cardSeq == null) set.cardSeq = sql`nextval('card_seq')`;
  await db
    .update(chat)
    .set(set)
    .where(and(eq(chat.id, id), eq(chat.userId, userId)));
}
