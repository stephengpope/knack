"use client";

import { useState } from "react";
import Link from "next/link";
import {
  X,
  Zap,
  KeyRound,
  Check,
  Trash2,
  RefreshCw,
  Plus,
  Server,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Logomark } from "@/components/brand/logo";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { ModelPicker } from "@/components/chat/model-picker";
import { UsersTab } from "@/components/administration/users-tab";
import type { ModelOption } from "@/lib/models";
import {
  PROVIDER_IDS,
  PROVIDERS,
  providerOf,
  type ProviderId,
} from "@/lib/providers";
import type { Settings, SmtpSettings } from "@/lib/settings";
import type { EndpointInfo } from "@/lib/endpoints";
import type { GlobalSecretSummary } from "@/lib/global-secrets";
import { GlobalSecretsTab } from "@/components/administration/global-secrets-tab";
import { SmtpTab } from "@/components/administration/smtp-tab";
import {
  setKeyAction,
  deleteKeyAction,
  setConnectionModeAction,
  setDefaultModelAction,
  setGeneralModelAction,
  refreshModelsAction,
  addEndpointAction,
  deleteEndpointAction,
  setVoiceKeyAction,
  deleteVoiceKeyAction,
  setRetentionDaysAction,
  setSkillReviewConfigAction,
} from "@/app/(app)/administration/actions";

type Last4 = Record<string, string | undefined>;
const TABS = [
  "AI Model",
  "Secrets",
  "Users",
  "Email",
  "Voice to text",
  "Retention",
  "Behavior",
] as const;
type Tab = (typeof TABS)[number];

export function AdministrationView({
  last4,
  settings,
  smtp,
  catalog,
  endpoints,
  globals,
  currentUserId,
}: {
  last4: Last4;
  settings: Settings;
  smtp: SmtpSettings;
  catalog: ModelOption[];
  endpoints: EndpointInfo[];
  globals: GlobalSecretSummary[];
  currentUserId: string;
}) {
  const [tab, setTab] = useState<Tab>("AI Model");

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
        <Logomark size={22} />
        <span className="text-[14.5px] font-bold">Administration</span>
        <Link
          href="/"
          className="ml-auto flex size-8 items-center justify-center rounded-[9px] border border-border bg-card text-ink-soft transition-colors hover:bg-accent hover:text-foreground"
          title="Close"
        >
          <X className="size-4" />
        </Link>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[186px] shrink-0 flex-col gap-0.5 border-r border-border p-3">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-[9px] px-3 py-2 text-left text-[13.5px] font-semibold transition-colors",
                tab === t
                  ? "bg-sidebar-accent text-accent-text"
                  : "text-ink-soft hover:bg-accent",
              )}
            >
              {t}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto px-9 pb-14 pt-8">
          <div className="max-w-[780px]">
            {tab === "AI Model" && (
              <ModelsTab
                last4={last4}
                settings={settings}
                catalog={catalog}
                endpoints={endpoints}
              />
            )}
            {tab === "Voice to text" && (
              <VoiceTab last4={settings.voiceLast4} />
            )}
            {tab === "Retention" && (
              <RetentionTab retentionDays={settings.retentionDays} />
            )}
            {tab === "Behavior" && (
              <BehaviorTab
                enabled={settings.skillReviewEnabled}
                interval={settings.skillReviewInterval}
              />
            )}
            {tab === "Email" && <SmtpTab smtp={smtp} />}
            {tab === "Secrets" && <GlobalSecretsTab globals={globals} />}
            {tab === "Users" && <UsersTab currentUserId={currentUserId} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function ModelsTab({
  last4,
  settings,
  catalog,
  endpoints,
}: {
  last4: Last4;
  settings: Settings;
  catalog: ModelOption[];
  endpoints: EndpointInfo[];
}) {
  const mode = settings.connectionMode;
  const gateway = mode === "gateway";
  const [editing, setEditing] = useState<ProviderId | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Server actions revalidatePath("/settings"); no client refresh needed.
  function setMode(m: "gateway" | "custom" | "compatible") {
    setConnectionModeAction(m);
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await refreshModelsAction();
      toast.success("Model list refreshed");
    } catch {
      toast.error("Couldn't refresh models");
    } finally {
      setRefreshing(false);
    }
  }

  const available =
    mode === "compatible"
      ? endpoints.map((e) => ({ id: e.id, label: e.name }))
      : gateway
        ? catalog
        : catalog.filter((m) => last4[providerOf(m.id)]);
  // The saved default may belong to a different mode — show the effective one.
  const fieldModel = available.some((m) => m.id === settings.defaultModel)
    ? settings.defaultModel
    : (available[0]?.id ?? settings.defaultModel);

  return (
    <>
      <h1 className="font-heading text-[27px] font-bold tracking-[-0.01em]">
        AI Model
      </h1>
      <p className="mt-1 text-[13.5px] text-ink-soft">
        Shared across the deployment — every user connects through the
        configuration you set here.
      </p>

      <SectionLabel className="mt-7">Connection</SectionLabel>
      <div className="grid grid-cols-3 gap-3">
        <ConnCard
          active={gateway}
          onClick={() => setMode("gateway")}
          icon={<Zap className="size-4 text-white" fill="white" />}
          iconClass="knack-gradient"
          title="Vercel AI Gateway"
          desc="One key, every provider. Zero setup."
          badge={<Pill tone="muted">Easiest</Pill>}
        />
        <ConnCard
          active={mode === "custom"}
          onClick={() => setMode("custom")}
          icon={<KeyRound className="size-4 text-ink-soft" />}
          iconClass="border border-input bg-muted"
          title="Your provider keys"
          desc="Your own keys, called directly — no gateway."
          badge={<Pill tone="green">Recommended</Pill>}
        />
        <ConnCard
          active={mode === "compatible"}
          onClick={() => setMode("compatible")}
          icon={<Server className="size-4 text-ink-soft" />}
          iconClass="border border-input bg-muted"
          title="OpenAI-compatible"
          desc="Your own endpoints — Ollama, vLLM, LiteLLM…"
          badge={<Pill tone="muted">Advanced</Pill>}
        />
      </div>

      {mode === "gateway" && (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[rgba(27,156,93,.13)] text-[#1B9C5D]">
            <Check className="size-[17px]" strokeWidth={2.4} />
          </span>
          <div className="min-w-0">
            <div className="text-[13.5px] font-bold">Gateway connected</div>
            <div className="text-[12px] text-ink-soft">
              Managed by this deployment · all providers · no key required
            </div>
          </div>
        </div>
      )}
      {mode === "custom" && (
        <div className="mt-6">
          <SectionLabel>Providers</SectionLabel>
          <div className="mb-3 flex flex-wrap gap-2">
            {PROVIDER_IDS.map((p) => {
              const connected = Boolean(last4[p]);
              const active = editing === p;
              return (
                <button
                  key={p}
                  onClick={() => setEditing(active ? null : p)}
                  className={cn(
                    "flex items-center gap-2 rounded-[10px] border bg-card px-3 py-2 text-[13px] font-semibold transition-colors",
                    active
                      ? "border-primary bg-sidebar-accent"
                      : "border-border hover:bg-accent",
                  )}
                >
                  <span
                    className="size-2.5 rounded-full"
                    style={{ background: PROVIDERS[p].accent }}
                  />
                  {PROVIDERS[p].label}
                  {connected && (
                    <Check className="size-3.5 text-[#1B9C5D]" strokeWidth={3} />
                  )}
                </button>
              );
            })}
          </div>
          {editing && (
            <KeyEditor
              provider={editing}
              last4={last4[editing]}
              onDone={() => setEditing(null)}
            />
          )}
        </div>
      )}
      {mode === "compatible" && <EndpointsSection endpoints={endpoints} />}

      <div className="mt-7 flex items-center justify-between">
        <SectionLabel className="mt-0">AI Agent</SectionLabel>
        {mode !== "compatible" && (
          <button
            onClick={refresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-soft transition-colors hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
            Refresh list
          </button>
        )}
      </div>
      <p className="-mt-1.5 mb-3 text-[12.5px] text-ink-soft">
        The model that powers the chat agent.
      </p>
      {available.length === 0 ? (
        <p className="rounded-xl border border-dashed border-input px-4 py-6 text-center text-[13px] text-ink-soft">
          {mode === "compatible"
            ? "Add an endpoint above to choose a model."
            : "Connect a provider key above to choose a model."}
        </p>
      ) : (
        <>
          <ModelPicker
            variant="field"
            model={fieldModel}
            onModelChange={(m) => setDefaultModelAction(m)}
            models={available}
          />
          <GeneralAiField
            available={available}
            generalModel={settings.generalModel}
            agentModel={fieldModel}
          />
        </>
      )}
    </>
  );
}

// Chat retention — a daily cron sweep deletes unstarred chats not used within
// the window (and their attachments). 0 = keep forever.
function RetentionTab({ retentionDays }: { retentionDays: number }) {
  const [value, setValue] = useState(String(retentionDays));
  const [busy, setBusy] = useState(false);
  const parsed = Number(value);
  const valid = Number.isInteger(parsed) && parsed >= 0;
  const dirty = value.trim() !== "" && parsed !== retentionDays;

  async function save() {
    if (!valid || !dirty) return;
    setBusy(true);
    try {
      await setRetentionDaysAction(parsed);
      toast.success(
        parsed === 0 ? "Retention disabled" : `Retention set to ${parsed} days`,
      );
    } catch {
      toast.error("Could not save retention");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="font-heading text-[27px] font-bold tracking-[-0.01em]">
        Retention
      </h1>
      <p className="mt-1 text-[13.5px] text-ink-soft">
        Automatically delete unstarred chats that haven&apos;t been used in a
        while, along with their attachments. Starred chats are always kept.
      </p>
      <SectionLabel className="mt-7">Auto-delete window</SectionLabel>
      <p className="-mt-1.5 mb-3 text-[12.5px] text-ink-soft">
        Delete unstarred chats not used in N days (0 = never).
      </p>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          aria-invalid={!valid}
          className="w-28"
        />
        <span className="text-[13px] text-ink-soft">days</span>
        <Button
          onClick={save}
          disabled={busy || !valid || !dirty}
          className="knack-gradient h-9 px-4 font-bold text-white"
        >
          {busy ? <Spinner /> : "Save"}
        </Button>
      </div>
    </>
  );
}

function BehaviorTab({
  enabled,
  interval,
}: {
  enabled: boolean;
  interval: number;
}) {
  const [on, setOn] = useState(enabled);
  const [value, setValue] = useState(String(interval));
  const [busy, setBusy] = useState(false);
  const parsed = Number(value);
  const valid = Number.isInteger(parsed) && parsed >= 1;
  const dirty = on !== enabled || (value.trim() !== "" && parsed !== interval);

  async function save() {
    if (!valid || !dirty) return;
    setBusy(true);
    try {
      await setSkillReviewConfigAction({ enabled: on, interval: parsed });
      toast.success("Self-improvement settings saved");
    } catch {
      toast.error("Could not save settings");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="font-heading text-[27px] font-bold tracking-[-0.01em]">
        Behavior
      </h1>
      <p className="mt-1 text-[13.5px] text-ink-soft">
        After a chat turn, the agent can review the conversation and improve its
        own skills — patching a skill when it was corrected, or saving a new one
        when a reusable technique emerged. Changes are committed to the project
        repo and take effect in future chats.
      </p>

      <SectionLabel className="mt-7">Self-improvement review</SectionLabel>
      <div className="flex items-center gap-3">
        <Switch id="skill-review" checked={on} onCheckedChange={setOn} />
        <label htmlFor="skill-review" className="text-[13.5px] text-ink-soft">
          Review conversations and update skills automatically
        </label>
      </div>

      <SectionLabel className="mt-7">Review interval</SectionLabel>
      <p className="-mt-1.5 mb-3 text-[12.5px] text-ink-soft">
        Run a review once a chat accumulates this many steps of agent activity.
        The counter resets after each review, and whenever the agent edits a
        skill itself.
      </p>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={1}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          aria-invalid={!valid}
          disabled={!on}
          className="w-28"
        />
        <span className="text-[13px] text-ink-soft">steps</span>
        <Button
          onClick={save}
          disabled={busy || !valid || !dirty}
          className="knack-gradient h-9 px-4 font-bold text-white"
        >
          {busy ? <Spinner /> : "Save"}
        </Button>
      </div>
    </>
  );
}

// AssemblyAI streaming key — powers voice-to-text dictation. Unset → the mic is
// hidden everywhere.
function VoiceTab({ last4 }: { last4: string | null }) {
  return (
    <>
      <h1 className="font-heading text-[27px] font-bold tracking-[-0.01em]">
        Voice to text
      </h1>
      <p className="mt-1 text-[13.5px] text-ink-soft">
        An AssemblyAI streaming key enables dictating by voice. Without it, the
        microphone is hidden everywhere.
      </p>
      <SectionLabel className="mt-7">AssemblyAI key</SectionLabel>
      <VoiceKeyEditor last4={last4} />
    </>
  );
}

function VoiceKeyEditor({ last4 }: { last4: string | null }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await setVoiceKeyAction(value);
      setValue("");
      toast.success("Voice key saved");
    } catch {
      toast.error("Could not save key");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteVoiceKeyAction();
      toast.success("Voice key removed");
    } catch {
      toast.error("Could not remove key");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl border bg-muted/50 py-1.5 pl-3.5 pr-1.5",
          last4 ? "border-[#1B9C5D]/40" : "border-input",
        )}
      >
        <KeyRound
          className={cn(
            "size-4 shrink-0",
            last4 ? "text-[#1B9C5D]" : "text-ink-faint",
          )}
        />
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={
            last4
              ? `Saved ••••${last4} — paste a new key to replace`
              : "Paste your AssemblyAI API key"
          }
          onKeyDown={(e) => e.key === "Enter" && save()}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-ink-faint"
        />
        {last4 && !value && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-[rgba(27,156,93,.13)] px-2 py-1 text-[11px] font-bold text-[#1B9C5D]">
            <Check className="size-3" strokeWidth={3} /> Saved
          </span>
        )}
        {last4 && (
          <button
            onClick={remove}
            disabled={busy}
            title="Remove key"
            className="flex size-8 shrink-0 items-center justify-center rounded-[9px] text-ink-faint transition-colors hover:bg-background hover:text-foreground"
          >
            <Trash2 className="size-4" />
          </button>
        )}
        <Button
          onClick={save}
          disabled={busy || !value.trim()}
          className="knack-gradient h-8 shrink-0 rounded-[9px] px-4 text-[13px] font-semibold text-white"
        >
          {busy ? <Spinner /> : "Save"}
        </Button>
      </div>
      <div className="mt-1.5 px-1 text-[12px]">
        <a
          href="https://www.assemblyai.com/dashboard/api-keys"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-accent-text hover:underline"
        >
          Get an AssemblyAI key
          <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  );
}

// "General AI" — a lighter model for background calls (e.g. naming chats).
// "Same as AI Agent" (null) reuses the agent model; "Custom" picks another from
// the same available list (same connection mode).
function GeneralAiField({
  available,
  generalModel,
  agentModel,
}: {
  available: ModelOption[];
  generalModel: string | null;
  agentModel: string;
}) {
  const isSame = !generalModel;
  const selected = available.some((m) => m.id === generalModel)
    ? (generalModel as string)
    : agentModel;

  return (
    <div className="mt-7">
      <SectionLabel className="mt-0">General AI</SectionLabel>
      <p className="-mt-1.5 mb-3 text-[12.5px] text-ink-soft">
        Used for lightweight background tasks like naming chats. Uses the same
        connection as your AI Agent.
      </p>
      <div className="mb-3 inline-flex rounded-[10px] border border-input bg-muted/50 p-0.5">
        <ToggleBtn active={isSame} onClick={() => setGeneralModelAction(null)}>
          Same as AI Agent
        </ToggleBtn>
        <ToggleBtn
          active={!isSame}
          onClick={() => {
            if (isSame) setGeneralModelAction(agentModel);
          }}
        >
          Custom
        </ToggleBtn>
      </div>
      {!isSame && (
        <ModelPicker
          variant="field"
          model={selected}
          onModelChange={(m) => setGeneralModelAction(m)}
          models={available}
        />
      )}
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-[8px] px-3 py-1.5 text-[13px] font-semibold transition-colors",
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-ink-soft hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function EndpointsSection({ endpoints }: { endpoints: EndpointInfo[] }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <SectionLabel className="mb-0">Endpoints</SectionLabel>
        {!adding && (
          <Button
            size="sm"
            onClick={() => setAdding(true)}
            className="knack-gradient h-8 font-bold text-white"
          >
            <Plus className="size-3.5" /> Add endpoint
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {endpoints.map((e) => (
          <EndpointRow key={e.id} endpoint={e} />
        ))}
        {endpoints.length === 0 && !adding && (
          <p className="rounded-xl border border-dashed border-input px-4 py-5 text-center text-[13px] text-ink-soft">
            No endpoints yet. Add one to connect your own model server.
          </p>
        )}
      </div>
      {adding && <EndpointForm onClose={() => setAdding(false)} />}
    </div>
  );
}

function EndpointRow({ endpoint }: { endpoint: EndpointInfo }) {
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      await deleteEndpointAction(endpoint.id);
      toast.success("Endpoint removed");
    } catch {
      toast.error("Couldn't remove endpoint");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
      <Server className="size-4 shrink-0 text-ink-soft" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-bold">{endpoint.name}</div>
        <div className="truncate font-mono text-[11.5px] text-ink-soft">
          {endpoint.model} · {endpoint.baseUrl}
        </div>
      </div>
      <Button
        variant="outline"
        size="icon"
        onClick={remove}
        disabled={busy}
        title="Remove"
        className="size-9"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}

function EndpointForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim() || !baseUrl.trim() || !model.trim()) {
      toast.error("Name, base URL and model are required");
      return;
    }
    setBusy(true);
    try {
      await addEndpointAction({ name, baseUrl, apiKey, model });
      toast.success("Endpoint added");
      onClose();
    } catch {
      toast.error("Couldn't add endpoint");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2.5 rounded-xl border border-input bg-muted/50 p-4">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name — e.g. Local Llama"
      />
      <Input
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        placeholder="Base URL — e.g. http://localhost:11434/v1"
      />
      <Input
        type="password"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder="API key — optional for local servers"
        autoComplete="off"
      />
      <Input
        value={model}
        onChange={(e) => setModel(e.target.value)}
        placeholder="Model id — e.g. llama-3.1-70b"
      />
      <div className="flex items-center gap-2">
        <Button
          onClick={save}
          disabled={busy}
          className="knack-gradient h-9 px-4 font-bold text-white"
        >
          {busy ? <Spinner /> : "Add endpoint"}
        </Button>
        <Button variant="outline" onClick={onClose} className="h-9">
          Cancel
        </Button>
      </div>
    </div>
  );
}

function KeyEditor({
  provider,
  last4,
  onDone,
}: {
  provider: ProviderId;
  last4?: string;
  onDone: () => void;
}) {
  const meta = PROVIDERS[provider];
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await setKeyAction(provider, value);
      setValue("");
      toast.success(`${meta.label} key saved`);
      onDone();
    } catch {
      toast.error("Could not save key");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteKeyAction(provider);
      toast.success(`${meta.label} key removed`);
      onDone();
    } catch {
      toast.error("Could not remove key");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl border bg-muted/50 py-1.5 pl-3.5 pr-1.5",
          last4 ? "border-[#1B9C5D]/40" : "border-input",
        )}
      >
        <KeyRound
          className={cn(
            "size-4 shrink-0",
            last4 ? "text-[#1B9C5D]" : "text-ink-faint",
          )}
        />
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={
            last4
              ? `Saved ••••${last4} — paste a new key to replace`
              : `Paste your ${meta.label} API key`
          }
          onKeyDown={(e) => e.key === "Enter" && save()}
          className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-ink-faint"
        />
        {last4 && !value && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-[rgba(27,156,93,.13)] px-2 py-1 text-[11px] font-bold text-[#1B9C5D]">
            <Check className="size-3" strokeWidth={3} /> Saved
          </span>
        )}
        {last4 && (
          <button
            onClick={remove}
            disabled={busy}
            title="Remove key"
            className="flex size-8 shrink-0 items-center justify-center rounded-[9px] text-ink-faint transition-colors hover:bg-background hover:text-foreground"
          >
            <Trash2 className="size-4" />
          </button>
        )}
        <Button
          onClick={save}
          disabled={busy || !value.trim()}
          className="knack-gradient h-8 shrink-0 rounded-[9px] px-4 text-[13px] font-semibold text-white"
        >
          {busy ? <Spinner /> : "Save"}
        </Button>
      </div>
      <div className="mt-1.5 px-1 text-[12px]">
        <a
          href={meta.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-accent-text hover:underline"
        >
          Get a {meta.label} key
          <ExternalLink className="size-3" />
        </a>
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
        "mb-3 text-[11px] font-bold uppercase tracking-[0.07em] text-ink-faint",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Pill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "green" | "muted";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold",
        tone === "green"
          ? "bg-[rgba(27,156,93,.13)] text-[#1B9C5D]"
          : "bg-muted text-ink-soft",
      )}
    >
      {tone === "green" && (
        <span className="size-1.5 rounded-full bg-[#1B9C5D]" />
      )}
      {children}
    </span>
  );
}

function ConnCard({
  active,
  onClick,
  icon,
  iconClass,
  title,
  desc,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  iconClass: string;
  title: string;
  desc: string;
  badge: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-[14px] border-[1.5px] p-4 text-left transition-colors",
        active
          ? "border-primary bg-sidebar-accent"
          : "border-border bg-card hover:bg-accent",
      )}
    >
      <div className="mb-2.5 flex items-center gap-2.5">
        <span
          className={cn(
            "flex size-[30px] items-center justify-center rounded-[9px]",
            iconClass,
          )}
        >
          {icon}
        </span>
        <span className="text-[14px] font-bold">{title}</span>
      </div>
      <p className="text-[12.5px] leading-relaxed text-ink-soft">{desc}</p>
      <div className="mt-2.5">{badge}</div>
    </button>
  );
}

