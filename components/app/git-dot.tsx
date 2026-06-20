"use client";

import { useChatGitStatus } from "./git-status-store";

/**
 * Sidebar leaf indicator: a small red dot when the chat's repo has
 * uncommitted/unpushed work (gitState === "dirty"). Hydrates from the server
 * `initial` value and updates live via the git-status store. Subscribing here
 * (a leaf) means a status change re-renders only this dot.
 */
export function GitDot({
  chatId,
  initial,
}: {
  chatId: string;
  initial: string | null;
}) {
  const override = useChatGitStatus(chatId);
  const state = override?.state ?? initial;
  if (state !== "dirty") return null;
  return (
    <span
      className="ml-1.5 size-2 shrink-0 rounded-full bg-red-500"
      title="Uncommitted changes — not yet pushed to GitHub"
      aria-label="Uncommitted changes"
    />
  );
}
