"use client";

import { useChatGitStatus } from "@/components/app/git-status-store";

/**
 * Chat-view leaf indicator: a small box showing the short commit hash, linking
 * to the commit on GitHub, shown when the chat's last sync committed cleanly.
 * Reads the git-status store (live) falling back to the server values, and
 * clears itself when the next turn flips the state away from "clean". Renders
 * nothing unless there's a clean state with a known sha and repo.
 */
export function GitCommitBadge({
  chatId,
  initialState,
  initialSha,
  repoUrl,
}: {
  chatId: string;
  initialState: string | null;
  initialSha: string | null;
  repoUrl: string | null;
}) {
  const override = useChatGitStatus(chatId);
  const state = override ? override.state : initialState;
  const sha = override ? override.sha : initialSha;
  if (state !== "clean" || !sha || !repoUrl) return null;
  const short = sha.slice(0, 7);
  return (
    <a
      href={`${repoUrl}/commit/${sha}`}
      target="_blank"
      rel="noreferrer"
      aria-label={`View commit ${short} on GitHub`}
      title="Committed — view on GitHub"
      className="ml-1 inline-flex shrink-0 items-center rounded-[3px] border border-green-700/40 bg-green-600/10 px-1.5 py-0.5 font-mono text-[11px] font-medium text-green-700 transition-colors hover:bg-green-600/20 dark:border-green-500/40 dark:text-green-400"
    >
      {short}
    </a>
  );
}
