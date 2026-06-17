"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import type { ChatListItem } from "@/lib/chats";

type ChatStore = {
  // Server chats merged with client-side pending chats and live title overrides.
  chats: ChatListItem[];
  // Insert a chat into the sidebar immediately (before the server knows about it).
  addPendingChat: (chat: ChatListItem) => void;
  // Override a chat's title in-place — used when the generated title streams in.
  setChatTitle: (id: string, title: string) => void;
};

const ChatStoreContext = createContext<ChatStore | null>(null);

export function ChatStoreProvider({
  serverChats,
  children,
}: {
  serverChats: ChatListItem[];
  children: React.ReactNode;
}) {
  // Chats created this session that the server prop doesn't include yet.
  const [pending, setPending] = useState<ChatListItem[]>([]);
  // Live title overrides keyed by chat id.
  const [titles, setTitles] = useState<Record<string, string>>({});

  // Derive on every render so server revalidations (rename/star/delete) flow
  // through automatically; pending chats already present server-side drop out.
  const chats = useMemo(() => {
    const serverIds = new Set(serverChats.map((c) => c.id));
    const merged = [
      ...pending.filter((p) => !serverIds.has(p.id)),
      ...serverChats,
    ];
    return merged.map((c) => (titles[c.id] ? { ...c, title: titles[c.id] } : c));
  }, [serverChats, pending, titles]);

  const addPendingChat = useCallback((chat: ChatListItem) => {
    setPending((p) => (p.some((x) => x.id === chat.id) ? p : [chat, ...p]));
  }, []);

  const setChatTitle = useCallback((id: string, title: string) => {
    setTitles((t) => ({ ...t, [id]: title }));
  }, []);

  const value = useMemo(
    () => ({ chats, addPendingChat, setChatTitle }),
    [chats, addPendingChat, setChatTitle],
  );

  return (
    <ChatStoreContext.Provider value={value}>
      {children}
    </ChatStoreContext.Provider>
  );
}

export function useChatStore() {
  const ctx = useContext(ChatStoreContext);
  if (!ctx) {
    throw new Error("useChatStore must be used within ChatStoreProvider");
  }
  return ctx;
}
