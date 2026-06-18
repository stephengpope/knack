"use client";

import { useSyncExternalStore } from "react";
import type { ChatListItem } from "@/lib/chats";

/**
 * Module-level store for live sidebar updates: chats created this session that
 * the server list doesn't have yet, plus title overrides streamed in after
 * generation. It's external (not React context) on purpose — only the sidebar
 * subscribes, so writing to it never re-renders the chat or the rest of the page.
 */
let pending: ChatListItem[] = [];
let titles: Record<string, string> = {};
let snapshot = { pending, titles };
const listeners = new Set<() => void>();

function emit() {
  snapshot = { pending, titles };
  for (const l of listeners) l();
}

/** Insert a chat into the sidebar immediately (before the server knows it). */
export function addPendingChat(chat: ChatListItem) {
  if (pending.some((c) => c.id === chat.id)) return;
  pending = [chat, ...pending];
  emit();
}

/** Override a chat's title in-place — used when the generated title arrives. */
export function setChatTitleOverride(id: string, title: string) {
  titles = { ...titles, [id]: title };
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

/** Subscribe to the live overrides. Only call this from the sidebar. */
export function useChatOverrides() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
