"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, Star, MessageSquare, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatListItem } from "@/lib/chats";

type Filter = "all" | "user" | "cron";

export function ChatsList({ chats }: { chats: ChatListItem[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const hasCron = chats.some((c) => c.source === "cron");
  const query = q.trim().toLowerCase();
  const filtered = chats.filter((c) => {
    if (filter === "cron" && c.source !== "cron") return false;
    if (filter === "user" && c.source === "cron") return false;
    if (query && !(c.title ?? "New chat").toLowerCase().includes(query)) return false;
    return true;
  });

  return (
    <div className="flex-1 overflow-y-auto px-6 py-10">
      <div className="mx-auto max-w-[780px]">
        <h1 className="font-heading text-[30px] font-bold tracking-[-0.01em]">
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

        {hasCron && (
          <div className="mt-3 inline-flex rounded-[10px] border border-input bg-muted p-0.5">
            {(
              [
                ["all", "All"],
                ["user", "Chats"],
                ["cron", "Scheduled"],
              ] as [Filter, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={cn(
                  "rounded-[8px] px-3 py-1 text-[12.5px] font-bold transition-colors",
                  filter === key
                    ? "bg-background text-accent-text shadow-sm"
                    : "text-ink-soft hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

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
                {c.source === "cron" ? (
                  <Clock className="size-4 shrink-0 text-primary" />
                ) : (
                  <MessageSquare className="size-4 shrink-0 text-ink-soft" />
                )}
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                  {c.title || "New chat"}
                </span>
                {c.source === "cron" && (
                  <span className="shrink-0 rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-bold text-primary">
                    Scheduled
                  </span>
                )}
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
