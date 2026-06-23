"use client";

import { useChatGitStatus } from "@/components/app/git-status-store";

import { cn } from "@/lib/utils";

/**
 * Chat-view leaf indicator: a small box showing the short commit hash, linking
 * to the commit on GitHub. Persists whenever the chat has a known commit + repo
 * — green the moment a turn's sync just landed, grey otherwise (after the next
 * turn starts, or on load from server state), but always linkable. Reads the
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
  if (!sha || !repoUrl) return null;
  const short = sha.slice(0, 7);
  return (
    <a
      href={fresh ? `${repoUrl}/commit/${sha}` : repoUrl}
      target="_blank"
      rel="noreferrer"
      aria-label={
        fresh ? `View commit ${short} on GitHub` : "View repository on GitHub"
      }
      title={fresh ? "Synced — view this commit" : "View repository on GitHub"}
      className={cn(
        "ml-1 inline-flex shrink-0 items-center rounded-[3px] border px-1.5 py-0.5 font-mono text-[11px] font-medium transition-colors",
        fresh
          ? "border-green-700/40 bg-green-600/10 text-green-700 hover:bg-green-600/20 dark:border-green-500/40 dark:text-green-400"
          : "border-border bg-muted/40 text-muted-foreground hover:bg-muted/70",
      )}
    >
      {short}
    </a>
  );
}
