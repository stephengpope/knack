"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Plus,
  MessageSquare,
  X,
  Shield,
  RotateCw,
  SquareMinus,
  Check,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  KANBAN_STATUSES,
  type BoardCard,
  type CardPatch,
  type ChecklistItem,
  type KanbanStatus,
} from "@/lib/board-types";
import type { ProjectSummary } from "@/lib/projects";
import { ProjectPicker } from "@/components/chat/project-picker";
import {
  createCardAction,
  updateCardAction,
  removeFromBoardAction,
  setSuperviseAction,
  loadSupervisorChatAction,
} from "@/app/(app)/board/actions";
import type { UIMessage } from "ai";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChatConversationUI } from "@/components/chat/chat-conversation-ui";

const STATUS_META: Record<KanbanStatus, { label: string; dot: string }> = {
  todo: { label: "Todo", dot: "bg-blue-500" },
  in_progress: { label: "In Progress", dot: "bg-primary" },
  blocked: { label: "Blocked", dot: "bg-red-500" },
  review: { label: "Review", dot: "bg-amber-500" },
  done: { label: "Done", dot: "bg-green-600" },
};

const ref = (c: BoardCard) =>
  c.cardSeq != null ? `KNK-${c.cardSeq}` : "KNK-—";

export function BoardView({
  cards: initialCards,
  projects,
  openCardId,
}: {
  cards: BoardCard[];
  projects: ProjectSummary[];
  openCardId: string | null;
}) {
  const [cards, setCards] = useState(initialCards);
  const [openId, setOpenId] = useState<string | null>(openCardId);
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<KanbanStatus | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  function handleDrop(status: KanbanStatus) {
    setDragOver(null);
    const id = draggingId;
    setDraggingId(null);
    if (!id) return;
    const card = cards.find((c) => c.id === id);
    if (!card || card.kanbanStatus === status) return;
    // Moving into in_progress restarts the run window server-side (updateCard).
    patchCard(id, { kanbanStatus: status });
  }

  const filtered = useMemo(
    () =>
      projectFilter === "all"
        ? cards
        : cards.filter((c) => c.projectId === projectFilter),
    [cards, projectFilter],
  );
  const running = filtered.filter((c) => c.kanbanStatus === "in_progress").length;
  const open = cards.find((c) => c.id === openId) ?? null;

  // Local-first mutation: patch the in-memory card immediately, then persist.
  function applyPatch(id: string, patch: Partial<BoardCard>) {
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  // Optimistic-only — no router.refresh() (it re-fetches the whole Server
  // Component, which flashes and flips a shared pending flag). The server action
  // still persists + revalidates for the next load.
  function patchCard(id: string, p: CardPatch) {
    // Mirror the server's run-window reset so the chip's iteration is right now.
    applyPatch(
      id,
      p.kanbanStatus === "in_progress"
        ? { ...p, iteration: 0, blockedReason: null }
        : p,
    );
    void updateCardAction(id, p);
  }

  function toggleSupervise(id: string, enabled: boolean) {
    applyPatch(id, { supervisorEnabled: enabled });
    void setSuperviseAction(id, enabled);
  }

  function remove(id: string) {
    setCards((cs) => cs.filter((c) => c.id !== id));
    setOpenId(null);
    void removeFromBoardAction(id);
  }

  function newCard() {
    setIsCreating(true);
    createCardAction({
      projectId: projectFilter === "all" ? null : projectFilter,
    })
      .then((card) => {
        setCards((cs) => [card, ...cs]);
        setOpenId(card.id);
      })
      .finally(() => setIsCreating(false));
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/40">
      {/* header */}
      <div className="flex h-[58px] shrink-0 items-center gap-3 border-b px-5">
        <h1 className="text-[19px] font-extrabold tracking-tight">Board</h1>
        {running > 0 && (
          <span className="flex items-center gap-1.5 rounded-full bg-sidebar-accent px-2.5 py-1 text-[11.5px] font-bold text-accent-text">
            <span className="size-1.5 animate-pulse rounded-full bg-primary" />
            {running} running
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {projects.length > 0 && (
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="h-9 w-[180px]">
                <SelectValue placeholder="All projects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All projects</SelectItem>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button onClick={newCard} disabled={isCreating} className="gap-1.5">
            {isCreating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            New card
          </Button>
        </div>
      </div>

      {/* columns */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-3.5">
        <div className="flex h-full min-w-max items-start gap-3.5">
          {KANBAN_STATUSES.map((status) => {
            const col = filtered.filter((c) => c.kanbanStatus === status);
            return (
              <div
                key={status}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOver !== status) setDragOver(status);
                }}
                onDragLeave={() =>
                  setDragOver((s) => (s === status ? null : s))
                }
                onDrop={() => handleDrop(status)}
                className={cn(
                  "flex max-h-full w-[286px] shrink-0 flex-col rounded-[14px] border bg-background transition-colors",
                  dragOver === status && "border-primary ring-2 ring-primary/30",
                )}
              >
                <div className="flex items-center gap-2 px-3.5 pb-2.5 pt-3">
                  <span
                    className={cn(
                      "size-2.5 rounded-full",
                      STATUS_META[status].dot,
                    )}
                  />
                  <span className="text-[13px] font-bold">
                    {STATUS_META[status].label}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11.5px] font-bold text-ink-faint">
                    {col.length}
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-2.5 pb-3 pt-0.5">
                  {col.map((c) => (
                    <CardChip
                      key={c.id}
                      card={c}
                      onClick={() => setOpenId(c.id)}
                      onDragStart={() => setDraggingId(c.id)}
                      onDragEnd={() => setDraggingId(null)}
                    />
                  ))}
                  {col.length === 0 && (
                    <div className="rounded-[10px] border border-dashed px-2.5 py-4 text-center text-[12px] text-ink-faint">
                      Nothing here
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {open && (
        <CardDrawer
          card={open}
          projects={projects}
          onClose={() => setOpenId(null)}
          onPatch={(p) => patchCard(open.id, p)}
          onToggleSupervise={(e) => toggleSupervise(open.id, e)}
          onRemove={() => remove(open.id)}
        />
      )}
    </div>
  );
}

function CardChip({
  card,
  onClick,
  onDragStart,
  onDragEnd,
}: {
  card: BoardCard;
  onClick: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const acDone = card.acceptanceCriteria.filter((a) => a.done).length;
  const acTotal = card.acceptanceCriteria.length;
  return (
    <button
      onClick={onClick}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "cursor-grab rounded-[12px] border bg-background p-3 text-left transition-colors hover:border-primary active:cursor-grabbing",
        card.kanbanStatus === "blocked" && "border-red-500/30",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        {card.supervisorEnabled && (
          <span
            title="Supervised"
            className="flex items-center rounded-md bg-green-600/10 px-1.5 py-0.5 text-green-600"
          >
            <Shield className="size-3" strokeWidth={2.4} />
          </span>
        )}
        <span className="ml-auto text-[11px] font-semibold text-ink-faint">
          {ref(card)}
        </span>
      </div>
      <div className="mb-2 text-[13.5px] font-bold leading-snug">
        {card.title ?? "Untitled"}
      </div>
      {acTotal > 0 && (
        <div className="mb-2 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.round((acDone / acTotal) * 100)}%` }}
            />
          </div>
          <span className="text-[11px] font-bold text-ink-soft">
            {acDone}/{acTotal} AC
          </span>
        </div>
      )}
      <div className="flex items-center gap-2 text-[11px] font-semibold text-ink-soft">
        <RotateCw className="size-3" />
        iter {card.iteration}
      </div>
    </button>
  );
}

function CardDrawer({
  card,
  projects,
  onClose,
  onPatch,
  onToggleSupervise,
  onRemove,
}: {
  card: BoardCard;
  projects: ProjectSummary[];
  onClose: () => void;
  onPatch: (patch: CardPatch) => void;
  onToggleSupervise: (enabled: boolean) => void;
  onRemove: () => void;
}) {
  const [supOpen, setSupOpen] = useState(false);
  const [supMsgs, setSupMsgs] = useState<UIMessage[] | null>(null);
  const [supLoading, setSupLoading] = useState(false);

  async function openSupervisor() {
    setSupOpen(true);
    setSupLoading(true);
    try {
      setSupMsgs(await loadSupervisorChatAction(card.id));
    } finally {
      setSupLoading(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-[480px] max-w-[92vw] flex-col border-l bg-background shadow-2xl">
        <div className="flex items-center gap-2 border-b p-4">
          <span className="text-[12px] font-semibold text-ink-faint">
            {ref(card)}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href={`/chat/${card.id}`}>
                <MessageSquare className="size-3.5" />
                Open chat
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={openSupervisor}
            >
              <Shield className="size-3.5 text-green-600" />
              Supervisor Logs
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="size-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          <Input
            defaultValue={card.title ?? ""}
            placeholder="Untitled"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== card.title) onPatch({ title: v });
            }}
            className="h-auto border-0 px-0 text-2xl font-extrabold tracking-tight shadow-none placeholder:font-extrabold placeholder:text-ink-faint focus-visible:ring-0 md:text-2xl"
          />

          <div className="flex gap-2.5">
            <div className="flex-1">
              <Label>Status</Label>
              <Select
                value={card.kanbanStatus}
                onValueChange={(v) =>
                  onPatch({ kanbanStatus: v as KanbanStatus })
                }
              >
                <SelectTrigger className="mt-1.5 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KANBAN_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_META[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <Label>Supervisor</Label>
              <div className="mt-1.5 flex h-9 items-center gap-2.5 rounded-[10px] border px-3">
                <Switch
                  checked={card.supervisorEnabled}
                  onCheckedChange={onToggleSupervise}
                />
                <span className="text-[13px] font-bold">
                  {card.supervisorEnabled ? "On" : "Off"}
                </span>
              </div>
            </div>
          </div>

          {projects.length > 0 && (
            <div>
              <Label>Project</Label>
              <div className="mt-1.5 flex h-9 items-center rounded-[10px] border px-3">
                <ProjectPicker
                  value={card.projectId ?? ""}
                  onChange={(id) => onPatch({ projectId: id })}
                  projects={projects}
                  // Locked once the card has started, like a chat's project.
                  disabled={card.kanbanStatus !== "todo"}
                />
              </div>
            </div>
          )}

          {card.blockedReason && (
            <div className="rounded-[10px] border border-red-500/30 bg-red-500/5 p-3 text-[12.5px] text-red-600">
              <span className="font-bold">Blocked:</span> {card.blockedReason}
            </div>
          )}

          <div>
            <Label>User story</Label>
            <Textarea
              defaultValue={card.userStory ?? ""}
              onBlur={(e) => {
                if (e.target.value !== (card.userStory ?? ""))
                  onPatch({ userStory: e.target.value });
              }}
              rows={2}
              placeholder="As a [user], I want [goal], so that [benefit]."
              className="mt-1.5"
            />
          </div>

          <div>
            <Label>Details</Label>
            <Textarea
              defaultValue={card.details ?? ""}
              onBlur={(e) => {
                if (e.target.value !== (card.details ?? ""))
                  onPatch({ details: e.target.value });
              }}
              rows={5}
              placeholder="Detailed brief — context, constraints, specifics the agent should know."
              className="mt-1.5"
            />
          </div>

          <Checklist
            label="Tasks"
            items={card.tasks}
            onChange={(items) => onPatch({ tasks: items })}
          />
          <Checklist
            label="Acceptance criteria"
            items={card.acceptanceCriteria}
            onChange={(items) => onPatch({ acceptanceCriteria: items })}
          />

          <div className="rounded-[12px] border p-4">
            <Label>Loop bookkeeping</Label>
            <div className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
              <Stat label="Iteration" value={String(card.iteration)} />
              <Stat
                label="Tests"
                value={`${card.testCases.filter((t) => t.status === "pass").length}/${card.testCases.length} pass`}
              />
              <Stat
                label="Last run"
                value={
                  card.lastRunAt
                    ? new Date(card.lastRunAt).toLocaleString()
                    : "—"
                }
              />
              <Stat
                label="Lease until"
                value={
                  card.leaseUntil
                    ? new Date(card.leaseUntil).toLocaleTimeString()
                    : "—"
                }
              />
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="gap-1.5 text-ink-soft hover:text-foreground"
          >
            <SquareMinus className="size-3.5" />
            Remove from board
          </Button>
        </div>
      </aside>

      <Dialog open={supOpen} onOpenChange={setSupOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-5xl">
          <DialogHeader className="shrink-0 border-b pb-3">
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Shield className="size-[18px] text-green-600" />
              Supervisor Logs · {ref(card)}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto pt-1">
            {supLoading ? (
              <div className="py-10 text-center text-sm text-ink-faint">
                Loading…
              </div>
            ) : supMsgs && supMsgs.length ? (
              <ChatConversationUI messages={supMsgs} />
            ) : (
              <div className="py-10 text-center text-sm text-ink-faint">
                No supervisor activity yet — it runs when the card is In Progress
                with Supervisor on.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Checklist({
  label,
  items,
  onChange,
}: {
  label: string;
  items: ChecklistItem[];
  onChange: (items: ChecklistItem[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const done = items.filter((i) => i.done).length;
  return (
    <div>
      <div className="flex items-center gap-2">
        <Label>{label}</Label>
        <span className="text-[11px] font-bold text-ink-soft">
          {done}/{items.length}
        </span>
      </div>
      <div className="mt-2 space-y-1.5">
        {items.map((item, i) => (
          <div
            key={i}
            className="flex items-start gap-2.5 rounded-[10px] border bg-card px-3 py-2.5"
          >
            <button
              onClick={() =>
                onChange(
                  items.map((x, j) =>
                    j === i ? { ...x, done: !x.done } : x,
                  ),
                )
              }
              className={cn(
                "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-md border",
                item.done ? "border-primary bg-primary" : "border-ink-faint",
              )}
            >
              {item.done && <Check className="size-3 text-white" strokeWidth={3} />}
            </button>
            <span
              className={cn(
                "flex-1 text-[12.5px] leading-snug",
                item.done && "text-ink-soft line-through",
              )}
            >
              {item.text}
            </span>
            <button
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="text-ink-faint hover:text-red-600"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) {
            onChange([...items, { text: draft.trim(), done: false }]);
            setDraft("");
          }
        }}
        placeholder={`Add ${label.toLowerCase()}…`}
        className="mt-1.5 h-8 text-[12.5px]"
      />
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-0.5 text-[11px] text-ink-soft">{label}</div>
      <div className="font-bold">{value}</div>
    </div>
  );
}
