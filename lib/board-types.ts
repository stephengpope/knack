// Client-safe board types + constants. The DB queries/mutations live in
// lib/board.ts (server-only); this module carries only what the UI needs, so a
// client component can import it without pulling in the database layer.

export type KanbanStatus =
  | "todo"
  | "in_progress"
  | "blocked"
  | "review"
  | "done";

export const KANBAN_STATUSES: KanbanStatus[] = [
  "todo",
  "in_progress",
  "blocked",
  "review",
  "done",
];

export type ChecklistItem = { text: string; done: boolean };
export type TestCase = {
  desc: string;
  status: "idle" | "running" | "pass" | "fail";
};

export type BoardCard = {
  id: string;
  cardSeq: number | null;
  title: string | null;
  kanbanStatus: KanbanStatus;
  supervisorEnabled: boolean;
  userStory: string | null;
  details: string | null;
  acceptanceCriteria: ChecklistItem[];
  tasks: ChecklistItem[];
  testCases: TestCase[];
  activeRole: string | null;
  blockedReason: string | null;
  iteration: number;
  runStartedAt: Date | null;
  lastRunAt: Date | null;
  leaseUntil: Date | null;
  projectId: string | null;
  updatedAt: Date;
};

export type CardPatch = Partial<{
  title: string;
  userStory: string | null;
  details: string | null;
  acceptanceCriteria: ChecklistItem[];
  tasks: ChecklistItem[];
  testCases: TestCase[];
  kanbanStatus: KanbanStatus;
  supervisorEnabled: boolean;
  projectId: string | null;
}>;
