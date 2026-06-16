"use client";

import { useOptimistic, startTransition, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  Plus,
  MessageSquare,
  Clock,
  Search,
  Star,
  Pencil,
  Trash2,
  MoreHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Logomark } from "@/components/brand/logo";
import { AccountMenu } from "@/components/app/account-menu";
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

type SidebarUser = { name: string; email: string; image: string | null };

type OptimisticAction =
  | { type: "star"; id: string }
  | { type: "rename"; id: string; title: string }
  | { type: "delete"; id: string };

export function Sidebar({
  chats: chatsProp,
  user,
}: {
  chats: ChatListItem[];
  user: SidebarUser;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const activeId = pathname.startsWith("/chat/") ? pathname.split("/")[2] : null;

  // Optimistic list: applied instantly inside a transition; the server action's
  // revalidation reconciles the real data back in. If the action throws, the
  // optimistic state automatically reverts (and we surface a toast).
  const [chats, applyOptimistic] = useOptimistic(
    chatsProp,
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
    if (id === activeId) router.push("/");
    startTransition(async () => {
      applyOptimistic({ type: "delete", id });
      try {
        await deleteChatAction(id);
      } catch {
        toast.error("Couldn't delete that chat");
      }
    });
  }

  const starred = chats.filter((c) => c.starred);
  const recents = chats.filter((c) => !c.starred);

  return (
    <aside className="flex w-[272px] shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex items-center gap-[11px] px-4 pb-3 pt-[18px]">
        <Logomark size={26} />
        <span className="text-[19px] font-extrabold tracking-[-0.03em]">
          Knack
        </span>
        <button
          className="ml-auto flex size-[30px] items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-accent hover:text-foreground"
          title="Search"
          onClick={() => toast("Search is coming soon")}
        >
          <Search className="size-[17px]" />
        </button>
      </div>

      <nav className="flex flex-col gap-0.5 px-3 pb-1 pt-1.5">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-[11px] px-[11px] py-[9px] text-[14px] font-bold text-accent-text transition-colors hover:bg-sidebar-accent"
        >
          <span className="knack-gradient knack-glow flex size-[26px] shrink-0 items-center justify-center rounded-lg">
            <Plus className="size-[15px] text-white" strokeWidth={2.6} />
          </span>
          New chat
        </Link>

        <NavItem
          href="/"
          icon={<MessageSquare className="size-[18px]" strokeWidth={1.9} />}
          label="Chats"
          active={pathname === "/" || pathname.startsWith("/chat/")}
        />

        <button
          onClick={() => toast("Cron — scheduled jobs are coming soon")}
          className="flex items-center gap-3 rounded-[11px] px-[11px] py-[9px] text-[14px] font-semibold text-foreground transition-colors hover:bg-accent"
        >
          <span className="flex w-[26px] shrink-0 justify-center text-ink-soft">
            <Clock className="size-[18px]" strokeWidth={1.9} />
          </span>
          Cron
          <span className="ml-auto rounded-full bg-sidebar-accent px-[7px] py-0.5 text-[10.5px] font-bold text-accent-text">
            Soon
          </span>
        </button>
      </nav>

      <div className="mt-1.5 flex-1 overflow-y-auto px-3 pb-2 pt-2.5">
        {starred.length > 0 && (
          <>
            <SectionLabel>Starred</SectionLabel>
            {starred.map((c) => (
              <ChatRow
                key={c.id}
                chat={c}
                active={c.id === activeId}
                onStar={onStar}
                onRename={onRename}
                onDelete={onDelete}
              />
            ))}
          </>
        )}

        <SectionLabel className="pt-3.5">Recent</SectionLabel>
        {recents.length === 0 && starred.length === 0 ? (
          <p className="px-2.5 py-2 text-[13px] text-ink-faint">
            No chats yet. Start a new one.
          </p>
        ) : (
          recents.map((c) => (
            <ChatRow
              key={c.id}
              chat={c}
              active={c.id === activeId}
              onStar={onStar}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))
        )}
      </div>

      <AccountMenu user={user} />
    </aside>
  );
}

function NavItem({
  href,
  icon,
  label,
  active,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-[11px] px-[11px] py-[9px] text-[14px] font-semibold transition-colors",
        active
          ? "bg-sidebar-accent text-accent-text"
          : "text-foreground hover:bg-accent",
      )}
    >
      <span
        className={cn(
          "flex w-[26px] shrink-0 justify-center",
          active ? "text-primary" : "text-ink-soft",
        )}
      >
        {icon}
      </span>
      {label}
    </Link>
  );
}

function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "px-2.5 pb-[7px] pt-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-faint",
        className,
      )}
    >
      {children}
    </div>
  );
}

function ChatRow({
  chat,
  active,
  onStar,
  onRename,
  onDelete,
}: {
  chat: ChatListItem;
  active: boolean;
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
        className="my-px w-full rounded-[9px] border border-primary bg-background px-2.5 py-[7px] text-[13.5px] outline-none"
      />
    );
  }

  return (
    <div className="group relative">
      <Link
        href={`/chat/${chat.id}`}
        className={cn(
          "flex items-center rounded-[9px] py-2 pl-2.5 pr-8 text-[13.5px] transition-colors",
          active
            ? "bg-sidebar-accent font-bold text-accent-text"
            : "font-medium text-ink-soft hover:bg-accent",
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          {chat.title || "New chat"}
        </span>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          title="More"
          className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-ink-faint opacity-0 transition hover:bg-muted hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal className="size-[15px]" />
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
