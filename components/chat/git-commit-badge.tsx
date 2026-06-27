"use client";

import { Check } from "lucide-react";

import { useChatGitStatus } from "@/components/app/git-status-store";

/**
 * Chat-view leaf indicator: a small green checkmark that appears only the moment
 * a turn's sync just lands, linking to that freshly-committed change on GitHub.
 * Once it goes stale (next turn starts, or load from server state) it vanishes —
 * the project picker to its left is the standing link to the repo. Reads the
 * git-status store (live) falling back to the server values.
 */
export function GitCommitBadge({
  chatId,
  initialSha,
  repoUrl,
}: {
  chatId: string;
  initialSha: string | null;
  repoUrl: string | null;
}) {
  const override = useChatGitStatus(chatId);
  const sha = override ? override.sha : initialSha;
  // Green only for a freshly-landed sync; server hydration is never fresh.
  const fresh = override?.fresh ?? false;
  if (!fresh || !sha || !repoUrl) return null;
  return (
    <a
      href={`${repoUrl}/commit/${sha}`}
      target="_blank"
      rel="noreferrer"
      aria-label="Synced — view this commit"
      title="Synced — view this commit"
      className="ml-1 inline-flex shrink-0 items-center rounded-full bg-green-500 p-0.5 text-white transition-colors hover:bg-green-600 dark:bg-green-400 dark:hover:bg-green-500"
    >
      <Check className="size-3" />
    </a>
  );
}
