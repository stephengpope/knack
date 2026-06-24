// Client-safe Task Helper types. The turn/zod schema live in run.ts (server);
// the dialog imports only these.

/** The finalized ticket the helper writes onto the card. */
export type TicketDraft = {
  title: string;
  userStory: string; // the plain-language "Goal" (intent + outcome)
  details: string;
  acceptanceCriteria: string[];
};

/** One completed clarification exchange. */
export type ClarifyRound = {
  questions: string[];
  answers: string[];
};

export type TaskHelperInput = {
  /** The user's original free-text request. */
  brief: string;
  /** Prior Q&A, oldest first. */
  rounds: ClarifyRound[];
};

export type TaskHelperResult = {
  /** True once the helper has enough to write the ticket. */
  done: boolean;
  /** Clarifying questions for this round (empty when done). */
  questions: string[];
  /** The finalized ticket — present only when done. */
  ticketDraft: TicketDraft | null;
};
