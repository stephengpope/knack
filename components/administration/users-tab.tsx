"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  UserPlus,
  Trash2,
  Copy,
  Check,
  ShieldCheck,
  User,
  ChevronDown,
  Search,
  X,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  listUsersAction,
  inviteUsersAction,
  setUserRoleAction,
  removeUserAction,
  type UserRow,
  type InviteResult,
} from "@/app/(app)/administration/user-actions";

// Deterministic avatar gradient per user.
const GRADIENTS = [
  ["#7C5CFC", "#6A40F0"],
  ["#3E7A55", "#2F6042"],
  ["#E0853C", "#C66A22"],
  ["#5B8DEF", "#3E6FD0"],
  ["#D9568B", "#B83A6E"],
  ["#2BA6A4", "#1E807E"],
];
function gradientFor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const [a, b] = GRADIENTS[h % GRADIENTS.length];
  return `linear-gradient(145deg, ${a}, ${b})`;
}
function initials(name: string) {
  return (
    name
      .split(" ")
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

export function UsersTab({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [query, setQuery] = useState("");

  async function reload() {
    try {
      setUsers(await listUsersAction());
    } catch {
      toast.error("Couldn't load users");
    }
  }

  useEffect(() => {
    let active = true;
    listUsersAction()
      .then((u) => {
        if (active) setUsers(u);
      })
      .catch(() => toast.error("Couldn't load users"));
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!users) return null;
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [users, query]);

  return (
    <>
      <div className="flex items-end gap-3.5">
        <div>
          <h1 className="font-heading text-[27px] font-bold tracking-[-0.01em]">
            User Admin
          </h1>
          <p className="mt-1 text-[13.5px] text-ink-soft">
            Invite people and control who can administer this deployment.
          </p>
        </div>
        <InviteDialog onInvited={reload} />
      </div>

      <div className="mb-4 mt-7 flex items-center gap-3">
        <SectionLabel>Members</SectionLabel>
        <div className="ml-auto flex h-9 w-[220px] items-center gap-2 rounded-[10px] border border-input bg-muted px-3 text-ink-faint focus-within:border-primary">
          <Search className="size-3.5" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search members"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-ink-faint"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-[14px] border border-border">
        <div className="grid grid-cols-[1fr_148px_44px] gap-3 border-b border-border bg-card px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.05em] text-ink-faint">
          <div>Member</div>
          <div>Role</div>
          <div />
        </div>
        {filtered === null ? (
          <div className="flex justify-center py-12 text-ink-soft">
            <Spinner />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-[13px] text-ink-soft">
            No members found.
          </div>
        ) : (
          filtered.map((u) => (
            <UserRowItem
              key={u.id}
              user={u}
              isSelf={u.id === currentUserId}
              onChanged={reload}
            />
          ))
        )}
      </div>

      <RolesLegend />
    </>
  );
}

function InviteDialog({ onInvited }: { onInvited: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>
        <Button className="knack-gradient knack-glow ml-auto h-10 shrink-0 rounded-[11px] px-4 font-bold text-white">
          <UserPlus className="size-4" /> Invite members
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={false}
        className="gap-0 overflow-hidden rounded-[18px] p-0 sm:max-w-[520px]"
      >
        <InviteDialogBody
          onInvited={onInvited}
          onClose={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function InviteDialogBody({
  onInvited,
  onClose,
}: {
  onInvited: () => void;
  onClose: () => void;
}) {
  const [emails, setEmails] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<InviteResult[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function addDraft(value = draft) {
    const parts = value
      .split(/[,\s]+/)
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    if (!parts.length) {
      setDraft("");
      return;
    }
    setEmails((prev) => {
      const set = [...prev];
      for (const p of parts) if (!set.includes(p)) set.push(p);
      return set;
    });
    setDraft("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === " ") {
      e.preventDefault();
      addDraft();
    } else if (e.key === "Backspace" && !draft && emails.length) {
      setEmails((prev) => prev.slice(0, -1));
    }
  }

  async function send() {
    const all = draft.trim() ? [...emails, draft.trim().toLowerCase()] : emails;
    if (!all.length) {
      toast.error("Add at least one email");
      return;
    }
    setBusy(true);
    try {
      const res = await inviteUsersAction({ emails: all, role });
      setResults(res);
      onInvited();
      const ok = res.filter((r) => !r.error).length;
      const emailed = res.filter((r) => r.emailed).length;
      if (ok) toast.success(`${ok} invite${ok > 1 ? "s" : ""} created`);
      if (emailed) toast.success(`${emailed} emailed`);
    } catch (e) {
      toast.error((e as Error).message || "Couldn't send invites");
    } finally {
      setBusy(false);
    }
  }

  const count = emails.length + (draft.trim() ? 1 : 0);

  if (results) {
    return (
      <ResultsPanel results={results} onClose={onClose} />
    );
  }

  return (
    <>
      <DialogHeaderRow onClose={onClose} />

      <div className="px-[22px] pb-1.5">
        <FieldLabel>Email addresses</FieldLabel>
        <div
          onClick={() => inputRef.current?.focus()}
          className="flex flex-wrap items-center gap-1.5 rounded-[12px] border border-input bg-muted p-2 focus-within:border-primary"
        >
          {emails.map((email, i) => (
            <span
              key={email}
              className="flex items-center gap-1.5 rounded-[9px] border border-border bg-card py-1 pl-2 pr-1 text-[13px] font-semibold"
            >
              <span
                className="flex size-[18px] items-center justify-center rounded-full text-[9px] font-bold text-white"
                style={{ background: gradientFor(email) }}
              >
                {email.slice(0, 2).toUpperCase()}
              </span>
              {email}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEmails((prev) => prev.filter((_, idx) => idx !== i));
                }}
                className="flex size-[18px] items-center justify-center rounded-[6px] text-ink-faint transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="size-3" strokeWidth={2.6} />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => draft.trim() && addDraft()}
            onPaste={(e) => {
              const text = e.clipboardData.getData("text");
              if (/[,\s]/.test(text)) {
                e.preventDefault();
                addDraft(text);
              }
            }}
            placeholder={emails.length ? "Add another…" : "name@company.com"}
            className="min-w-[140px] flex-1 bg-transparent px-1 py-1 text-[13.5px] outline-none placeholder:text-ink-faint"
            autoFocus
          />
        </div>
        <p className="mt-1.5 text-[12px] text-ink-faint">
          Separate with Enter, comma, or space. Paste a list to add many at once.
        </p>

        <FieldLabel className="mt-[18px]">Role for these invites</FieldLabel>
        <div className="flex flex-col gap-2">
          <RoleRadio
            selected={role === "admin"}
            onClick={() => setRole("admin")}
            title="Admin"
            desc="Manage users and roles, and configure shared AI Models."
          />
          <RoleRadio
            selected={role === "user"}
            onClick={() => setRole("user")}
            title="Member"
            desc="Create and run chats and manage their own profile."
          />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 border-t border-border bg-muted/40 px-[22px] py-4">
        <span className="ml-auto" />
        <Button variant="outline" onClick={onClose} className="h-10 rounded-[11px]">
          Cancel
        </Button>
        <Button
          onClick={send}
          disabled={busy || count === 0}
          className="knack-gradient knack-glow h-10 rounded-[11px] px-[18px] font-bold text-white"
        >
          {busy ? (
            <Spinner />
          ) : (
            <>
              <Send className="size-4" />
              {count > 1 ? `Send ${count} invites` : "Send invite"}
            </>
          )}
        </Button>
      </div>
    </>
  );
}

function DialogHeaderRow({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-start gap-3 px-[22px] pb-4 pt-[22px]">
      <span className="flex size-[42px] shrink-0 items-center justify-center rounded-[12px] bg-sidebar-accent text-accent-text">
        <UserPlus className="size-[21px]" />
      </span>
      <div className="min-w-0 flex-1">
        <DialogTitle className="text-[18px] font-extrabold tracking-[-0.02em]">
          Invite members
        </DialogTitle>
        <DialogDescription className="mt-0.5 text-[13px] text-ink-soft">
          Add people to Knack. They&apos;ll get a link to set their password and
          join.
        </DialogDescription>
      </div>
      <button
        onClick={onClose}
        className="flex size-8 items-center justify-center rounded-[9px] text-ink-faint transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="size-[17px]" />
      </button>
    </div>
  );
}

function ResultsPanel({
  results,
  onClose,
}: {
  results: InviteResult[];
  onClose: () => void;
}) {
  return (
    <>
      <div className="flex items-start gap-3 px-[22px] pb-4 pt-[22px]">
        <span className="flex size-[42px] shrink-0 items-center justify-center rounded-[12px] bg-[rgba(27,156,93,.13)] text-[#1B9C5D]">
          <Check className="size-[22px]" strokeWidth={2.6} />
        </span>
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-[18px] font-extrabold tracking-[-0.02em]">
            Invites sent
          </DialogTitle>
          <DialogDescription className="mt-0.5 text-[13px] text-ink-soft">
            Copy any link to share it directly.
          </DialogDescription>
        </div>
      </div>

      <div className="flex max-h-[50vh] flex-col gap-2.5 overflow-y-auto px-[22px] pb-2">
        {results.map((r) => (
          <div
            key={r.email}
            className="rounded-[12px] border border-border bg-card p-3"
          >
            <div className="flex items-center gap-2">
              <span className="truncate text-[13px] font-bold">{r.email}</span>
              {r.error ? (
                <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-ink-soft">
                  {r.error}
                </span>
              ) : r.emailed ? (
                <span className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-[rgba(27,156,93,.13)] px-2 py-0.5 text-[11px] font-bold text-[#1B9C5D]">
                  <Check className="size-3" strokeWidth={3} /> Emailed
                </span>
              ) : (
                <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-ink-soft">
                  Link only
                </span>
              )}
            </div>
            {r.link && <CopyLink link={r.link} className="mt-2" />}
          </div>
        ))}
      </div>

      <div className="mt-3 flex justify-end border-t border-border bg-muted/40 px-[22px] py-4">
        <Button
          onClick={onClose}
          className="knack-gradient h-10 rounded-[11px] px-5 font-bold text-white"
        >
          Done
        </Button>
      </div>
    </>
  );
}

function FieldLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-ink-faint",
        className,
      )}
    >
      {children}
    </div>
  );
}

function RoleRadio({
  selected,
  onClick,
  title,
  desc,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 rounded-[12px] border-[1.5px] p-3 text-left transition-colors",
        selected
          ? "border-primary bg-sidebar-accent"
          : "border-border bg-card hover:bg-accent",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full border-2",
          selected ? "border-primary" : "border-ink-faint",
        )}
      >
        {selected && <span className="size-2.5 rounded-full bg-primary" />}
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-bold">{title}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-ink-soft">
          {desc}
        </span>
      </span>
    </button>
  );
}

function CopyLink({ link, className }: { link: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy");
    }
  }
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-[10px] border border-input bg-muted py-1.5 pl-3.5 pr-1.5",
        className,
      )}
    >
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-soft">
        {link}
      </span>
      <button
        onClick={copy}
        title="Copy invite link"
        className="flex size-8 shrink-0 items-center justify-center rounded-[8px] text-ink-soft transition-colors hover:bg-accent hover:text-foreground"
      >
        {copied ? (
          <Check className="size-4 text-[#1B9C5D]" strokeWidth={3} />
        ) : (
          <Copy className="size-4" />
        )}
      </button>
    </div>
  );
}

function UserRowItem({
  user,
  isSelf,
  onChanged,
}: {
  user: UserRow;
  isSelf: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const role = user.role === "admin" ? "admin" : "user";

  async function changeRole(next: "user" | "admin") {
    if (next === role) return;
    setBusy(true);
    try {
      await setUserRoleAction(user.id, next);
      toast.success(`${user.name} is now ${next === "admin" ? "an admin" : "a member"}`);
      onChanged();
    } catch {
      toast.error("Couldn't change role");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await removeUserAction(user.id);
      toast.success(`${user.name} removed`);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't remove user");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-[1fr_148px_44px] items-center gap-3 border-b border-border px-4 py-3 transition-colors last:border-0 hover:bg-accent/40">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-[10px] text-[12.5px] font-bold text-white"
          style={{ background: gradientFor(user.id) }}
        >
          {initials(user.name)}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-bold">
            {user.name}
            {isSelf && (
              <span className="ml-1.5 font-semibold text-ink-faint">(You)</span>
            )}
          </div>
          <div className="truncate text-[12px] text-ink-soft">{user.email}</div>
        </div>
      </div>

      <RolePillDropdown
        role={role}
        disabled={busy || isSelf}
        onChange={changeRole}
      />

      {isSelf ? (
        <span />
      ) : (
        <button
          onClick={remove}
          disabled={busy}
          title="Remove user"
          className="flex size-8 items-center justify-center rounded-[8px] text-ink-faint transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <Trash2 className="size-4" />
        </button>
      )}
    </div>
  );
}

function RolePillDropdown({
  role,
  disabled,
  onChange,
}: {
  role: "user" | "admin";
  disabled?: boolean;
  onChange: (r: "user" | "admin") => void;
}) {
  const label = role === "admin" ? "Admin" : "Member";
  const Icon = role === "admin" ? ShieldCheck : User;
  if (disabled) {
    return (
      <span className="inline-flex w-fit items-center gap-1.5 rounded-[9px] border border-input bg-muted px-2.5 py-1.5 text-[12.5px] font-bold text-ink-soft">
        <Icon className="size-3.5" />
        {label}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex w-fit items-center gap-1.5 rounded-[9px] border border-input bg-card px-2.5 py-1.5 text-[12.5px] font-bold transition-colors hover:bg-accent">
        <Icon className="size-3.5" />
        {label}
        <ChevronDown className="size-3 text-ink-faint" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[180px]">
        <RoleMenuItem
          active={role === "user"}
          onClick={() => onChange("user")}
          icon={<User className="size-[15px]" />}
          title="Member"
          desc="Chats & profile only"
        />
        <RoleMenuItem
          active={role === "admin"}
          onClick={() => onChange("admin")}
          icon={<ShieldCheck className="size-[15px]" />}
          title="Admin"
          desc="Full settings access"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RoleMenuItem({
  active,
  onClick,
  icon,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <DropdownMenuItem onClick={onClick} className="flex items-start gap-2.5 py-2">
      <span className="mt-0.5 text-ink-soft">{icon}</span>
      <span className="flex-1">
        <span className="block text-[13px] font-bold">{title}</span>
        <span className="block text-[11.5px] text-ink-soft">{desc}</span>
      </span>
      {active && <Check className="mt-0.5 size-3.5 text-accent-text" strokeWidth={3} />}
    </DropdownMenuItem>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-ink-faint">
      {children}
    </div>
  );
}

function RolesLegend() {
  const roles = [
    {
      name: "Admin",
      desc: "Manage users and roles, and configure shared AI Models. Full settings access.",
    },
    {
      name: "Member",
      desc: "Create and run chats and manage their own profile. No settings access.",
    },
  ];
  return (
    <div className="mt-7 rounded-[14px] border border-border bg-card p-5">
      <div className="mb-3 text-[13px] font-bold">What roles can do</div>
      <div className="flex flex-col gap-2.5">
        {roles.map((r) => (
          <div key={r.name} className="flex items-start gap-3">
            <span className="w-16 shrink-0 text-[12.5px] font-bold text-accent-text">
              {r.name}
            </span>
            <span className="text-[12.5px] leading-relaxed text-ink-soft">
              {r.desc}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

