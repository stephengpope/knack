"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, Star, MessageSquare } from "lucide-react";
import type { ChatListItem } from "@/lib/chats";

export function ChatsList({ chats }: { chats: ChatListItem[] }) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const filtered = query
    ? chats.filter((c) => (c.title ?? "New chat").toLowerCase().includes(query))
    : chats;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-10">
      <div className="mx-auto max-w-[780px]">
        <h1 className="font-heading text-[30px] font-medium tracking-[-0.01em]">
          Chats
        </h1>
        <p className="mt-1 text-[14px] text-ink-soft">
          {chats.length} conversation{chats.length === 1 ? "" : "s"}
        </p>

        <div className="relative mt-6">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search chats by name…"
            autoFocus
            className="w-full rounded-xl border border-input bg-card py-2.5 pl-10 pr-4 text-[14px] outline-none transition-colors focus:border-primary"
          />
        </div>

        <div className="mt-4 flex flex-col gap-1.5">
          {filtered.length === 0 ? (
            <p className="rounded-xl border border-dashed border-input px-4 py-10 text-center text-[13.5px] text-ink-soft">
              {chats.length === 0
                ? "No chats yet — start a new one."
                : "No chats match your search."}
            </p>
          ) : (
            filtered.map((c) => (
              <Link
                key={c.id}
                href={`/chat/${c.id}`}
                className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-accent"
              >
                <MessageSquare className="size-4 shrink-0 text-ink-soft" />
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                  {c.title || "New chat"}
                </span>
                {c.starred && (
                  <Star className="size-4 shrink-0 fill-primary text-primary" />
                )}
                <span
                  suppressHydrationWarning
                  className="shrink-0 text-[12px] text-ink-faint"
                >
                  {new Date(c.updatedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
