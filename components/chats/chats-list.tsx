"use client";

import { useOptimistic, startTransition, useState } from "react";
import Link from "next/link";
import {
  Search,
  Star,
  MessageSquare,
  Clock,
  Pencil,
  Trash2,
  MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ChatListItem } from "@/lib/chats";
import {
  renameChatAction,
  deleteChatAction,
  toggleStarAction,
} from "@/app/(app)/actions";

type Filter = "all" | "user" | "cron";

type OptimisticAction =
  | { type: "star"; id: string }
  | { type: "rename"; id: string; title: string }
  | { type: "delete"; id: string };

export function ChatsList({ chats: serverChats }: { chats: ChatListItem[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  // Optimistic list: applied instantly inside a transition; the server action's
  // revalidation reconciles the real data back in. If the action throws, the
  // optimistic state reverts (and we surface a toast).
  const [chats, applyOptimistic] = useOptimistic(
    serverChats,
    (state, action: OptimisticAction) => {
      switch (action.type) {
        case "star":
          return state.map((c) =>
            c.id === action.id ? { ...c, starred: !c.starred } : c,
          );
        case "rename":
          return state.map((c) =>
            c.id === action.id ? { ...c, title: action.title } : c,
          );
        case "delete":
          return state.filter((c) => c.id !== action.id);
      }
    },
  );

  function onStar(id: string) {
    startTransition(async () => {
      applyOptimistic({ type: "star", id });
      try {
        await toggleStarAction(id);
      } catch {
        toast.error("Couldn't update that chat");
      }
    });
  }
  function onRename(id: string, title: string) {
    startTransition(async () => {
      applyOptimistic({ type: "rename", id, title });
      try {
        await renameChatAction(id, title);
      } catch {
        toast.error("Couldn't rename that chat");
      }
    });
  }
  function onDelete(id: string) {
    startTransition(async () => {
      applyOptimistic({ type: "delete", id });
      try {
        await deleteChatAction(id);
      } catch {
        toast.error("Couldn't delete that chat");
      }
    });
  }

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
              <ChatRow
                key={c.id}
                chat={c}
                onStar={onStar}
                onRename={onRename}
                onDelete={onDelete}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ChatRow({
  chat,
  onStar,
  onRename,
  onDelete,
}: {
  chat: ChatListItem;
  onStar: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [value, setValue] = useState(chat.title ?? "");

  function commitRename() {
    setRenaming(false);
    const next = value.trim();
    if (next && next !== chat.title) onRename(chat.id, next);
    else setValue(chat.title ?? "");
  }

  if (renaming) {
    return (
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commitRename}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitRename();
          if (e.key === "Escape") {
            setValue(chat.title ?? "");
            setRenaming(false);
          }
        }}
        className="w-full rounded-xl border border-primary bg-background px-4 py-3 text-[14px] font-semibold outline-none"
      />
    );
  }

  return (
    <div className="group relative">
      <Link
        href={`/chat/${chat.id}`}
        className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 pr-12 transition-colors hover:bg-accent"
      >
        {chat.source === "cron" ? (
          <Clock className="size-4 shrink-0 text-primary" />
        ) : (
          <MessageSquare className="size-4 shrink-0 text-ink-soft" />
        )}
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
          {chat.title || "New chat"}
        </span>
        {chat.source === "cron" && (
          <span className="shrink-0 rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-bold text-primary">
            Scheduled
          </span>
        )}
        {chat.starred && (
          <Star className="size-4 shrink-0 fill-primary text-primary" />
        )}
        <span
          suppressHydrationWarning
          className="shrink-0 text-[12px] text-ink-faint transition-opacity group-hover:opacity-0"
        >
          {new Date(chat.updatedAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </span>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          title="More"
          className="absolute right-2.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-faint opacity-0 transition hover:bg-muted hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[168px]">
          <DropdownMenuItem onClick={() => onStar(chat.id)}>
            <Star
              className={cn(
                "size-[15px]",
                chat.starred && "fill-primary text-primary",
              )}
            />
            {chat.starred ? "Unstar" : "Star"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setRenaming(true)}>
            <Pencil className="size-[15px]" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onDelete(chat.id)}
          >
            <Trash2 className="size-[15px]" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
