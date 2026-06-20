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
export type GitStatusValue = { state: string | null; sha: string | null };

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
