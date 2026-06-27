"use client";

import { useState } from "react";
import { KeyRound, Check, Trash2, Plus, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useConfirm } from "@/components/app/confirm";
import type { GlobalSecretSummary } from "@/lib/global-secrets";
import { BUILTIN_TOKENS, isBuiltinToken } from "@/lib/secrets/builtins";
import {
  setGlobalTokenAction,
  deleteGlobalTokenAction,
} from "@/app/(app)/administration/actions";

export function GlobalSecretsTab({
  globals,
}: {
  globals: GlobalSecretSummary[];
}) {
  const byName = new Map(globals.map((g) => [g.name, g]));
  const others = globals.filter((g) => !isBuiltinToken(g.name));
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-ink-soft">
        Global tokens are set once here and cascade to every user. A user who sets
        the same token name in their own Secrets overrides the global for them.
        Values are encrypted at rest — only the last 4 characters are shown.
      </p>

      {/* Built-in tokens */}
      <section className="flex flex-col gap-3">
        <SectionLabel>Built-in tokens</SectionLabel>
        <p className="-mt-1 text-xs text-ink-soft">
          Known token names the system and built-in skills look for. Optional —
          set one to provide it for all users.
        </p>
        <div className="flex flex-col gap-4">
          {BUILTIN_TOKENS.map((b) => (
            <BuiltinRow
              key={b.name}
              name={b.name}
              label={b.label}
              hint={b.hint}
              url={b.url}
              last4={byName.get(b.name)?.last4}
            />
          ))}
        </div>
      </section>

      {/* Free-form global tokens */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <SectionLabel className="mb-0">Other global tokens</SectionLabel>
          {!adding && (
            <Button
              size="sm"
              onClick={() => setAdding(true)}
              className="knack-gradient h-8 font-bold text-white"
            >
              <Plus className="size-3.5" /> Add token
            </Button>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {others.map((g) => (
            <OtherRow key={g.name} secret={g} />
          ))}
          {others.length === 0 && !adding && (
            <p className="rounded-xl border border-dashed border-input px-4 py-5 text-center text-sm text-ink-soft">
              No custom global tokens yet.
            </p>
          )}
        </div>
        {adding && <AddForm onClose={() => setAdding(false)} />}
      </section>
    </div>
  );
}

function BuiltinRow({
  name,
  label,
  hint,
  url,
  last4,
}: {
  name: string;
  label: string;
  hint: string;
  url: string;
  last4?: string;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

  async function save() {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await setGlobalTokenAction(name, value, hint);
      setValue("");
      toast.success(`${label} token saved`);
    } catch (e) {
      toast.error((e as Error).message || "Could not save token");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (
      !(await confirm({
        title: `Delete “${name}”?`,
        description: "The shared token is removed for the whole deployment.",
        confirmLabel: "Delete",
      }))
    )
      return;
    setBusy(true);
    try {
      await deleteGlobalTokenAction(name);
      toast.success(`${label} token removed`);
    } catch {
      toast.error("Could not remove token");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between px-1">
        <span className="font-mono text-xs font-bold">{name}</span>
        <span className="text-xs text-ink-soft">{label}</span>
      </div>
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl border bg-muted/50 py-1.5 pl-3.5 pr-1.5",
          last4 ? "border-success/40" : "border-input",
        )}
      >
        <KeyRound
          className={cn(
            "size-4 shrink-0",
            last4 ? "text-success" : "text-ink-faint",
          )}
        />
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={
            last4
              ? `Saved ••••${last4} — paste a new value to replace`
              : `Paste a ${label} token`
          }
          onKeyDown={(e) => e.key === "Enter" && save()}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-ink-faint"
        />
        {last4 && !value && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-success-soft px-2 py-1 text-xs font-bold text-success">
            <Check className="size-3" strokeWidth={3} /> Saved
          </span>
        )}
        {last4 && (
          <button
            onClick={remove}
            disabled={busy}
            title="Remove token"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-background hover:text-foreground"
          >
            <Trash2 className="size-4" />
          </button>
        )}
        <Button
          onClick={save}
          disabled={busy || !value.trim()}
          className="knack-gradient h-8 shrink-0 rounded-md px-4 text-sm font-semibold text-white"
        >
          {busy ? <Spinner /> : "Save"}
        </Button>
      </div>
      <div className="mt-1.5 px-1 text-xs text-ink-soft">
        {hint}{" "}
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-accent-text hover:underline"
        >
          Get a key
          <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  );
}

function OtherRow({ secret }: { secret: GlobalSecretSummary }) {
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  async function remove() {
    if (
      !(await confirm({
        title: `Delete “${secret.name}”?`,
        description: "The shared token is removed for the whole deployment.",
        confirmLabel: "Delete",
      }))
    )
      return;
    setBusy(true);
    try {
      await deleteGlobalTokenAction(secret.name);
      toast.success("Deleted");
    } catch {
      toast.error("Couldn't delete");
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <KeyRound className="size-4 shrink-0 text-ink-faint" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-sm font-bold">
          {secret.name}
        </div>
        {secret.description && (
          <div className="truncate text-xs text-ink-soft">
            {secret.description}
          </div>
        )}
      </div>
      <span className="text-sm text-ink-faint">••••{secret.last4}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={remove}
        disabled={busy}
        title="Delete"
      >
        {busy ? <Spinner /> : <Trash2 className="size-4" />}
      </Button>
    </div>
  );
}

function AddForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim() || !value.trim()) {
      toast.error("Name and value are required");
      return;
    }
    setBusy(true);
    try {
      await setGlobalTokenAction(name, value, description || undefined);
      toast.success("Token added");
      onClose();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't add token");
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2.5 rounded-xl border border-input bg-muted/50 p-4">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name — e.g. STRIPE_API_KEY"
        autoComplete="off"
      />
      <Input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description — optional"
      />
      <Input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Value"
        autoComplete="off"
      />
      <div className="flex items-center gap-2">
        <Button
          onClick={save}
          disabled={busy}
          className="knack-gradient h-9 px-4 font-bold text-white"
        >
          {busy ? <Spinner /> : "Add token"}
        </Button>
        <Button variant="outline" onClick={onClose} className="h-9">
          Cancel
        </Button>
      </div>
    </div>
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
        "mb-1 text-xs font-bold uppercase tracking-wide text-ink-faint",
        className,
      )}
    >
      {children}
    </div>
  );
}
