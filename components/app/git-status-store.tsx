"use client";

import { useSyncExternalStore } from "react";

/**
 * Module-level store for live git-status updates, mirroring chat-store.tsx. The
 * sidebar dot and the chat-view commit badge subscribe to it; writing a status
 * (after a turn's background gitSync settles) re-renders only those leaf
 * indicators — never the chat message window, the layout, or the sidebar shell.
 * Server `gitState` is the source of truth on load; this only carries live
 * overrides keyed by chat id.
 */
export type GitStatusValue = {
  state: string | null;
  sha: string | null;
  // `true` only for the moment a turn's sync just landed (badge shows green);
  // `false` once the next turn starts (badge persists grey, still linkable).
  fresh?: boolean;
};

let statuses: Record<string, GitStatusValue> = {};
let snapshot = { statuses };
const listeners = new Set<() => void>();

function emit() {
  snapshot = { statuses };
  for (const l of listeners) l();
}

/** Override a chat's git status in-place (from the post-turn re-read). */
export function setChatGitStatus(id: string, value: GitStatusValue) {
  statuses = { ...statuses, [id]: value };
  emit();
}

/**
 * Mark a chat's badge stale (grey) when the next turn starts, keeping the last
 * known commit so it stays visible + linkable. Falls back to the server sha
 * when there's no live override yet.
 */
export function markChatGitStale(id: string, fallbackSha: string | null) {
  const prev = statuses[id];
  statuses = {
    ...statuses,
    [id]: { state: prev?.state ?? null, sha: prev?.sha ?? fallbackSha, fresh: false },
  };
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function getSnapshot() {
  return snapshot;
}

/** Read the live override for one chat (undefined = fall back to server state). */
export function useChatGitStatus(id: string): GitStatusValue | undefined {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return snap.statuses[id];
}
