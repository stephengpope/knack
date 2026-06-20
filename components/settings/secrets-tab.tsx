"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus,
  Trash2,
  Copy,
  Check,
  Eye,
  EyeOff,
  RefreshCw,
  Unplug,
  KeyRound,
  Link2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SecretSummary } from "@/lib/user-secrets";
import {
  addStaticSecretAction,
  addOAuthConnectionAction,
  startConnectAction,
  disconnectAction,
  deleteSecretAction,
} from "@/app/(app)/settings/secret-actions";

export type ProviderOption = {
  id: string;
  label: string;
  defaultScopes: string[];
  custom: boolean;
  hint: string | null;
};

type Mode = "token" | "oauth";

function oauthErrorMessage(code: string): string {
  switch (code) {
    case "invalid_request":
      return "Authorization failed (invalid request).";
    case "connection_not_found":
      return "Connection not found.";
    case "exchange_failed":
      return "Token exchange failed — check client credentials and redirect URI.";
    case "access_denied":
      return "Access was denied.";
    default:
      return `Authorization error: ${code}`;
  }
}

export function SecretsTab({
  secrets,
  redirectUri,
  providers,
}: {
  secrets: SecretSummary[];
  redirectUri: string;
  providers: ProviderOption[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const connected = params.get("connected");
  const error = params.get("error");

  const [mode, setMode] = useState<Mode>(
    connected || error ? "oauth" : "token",
  );

  // Surface the OAuth callback outcome, then strip the query params.
  useEffect(() => {
    if (connected) toast.success(`Connected ${connected}`);
    else if (error) toast.error(oauthErrorMessage(error));
    if (connected || error) router.replace("/settings?tab=Secrets");
  }, [connected, error, router]);

  const tokens = secrets.filter((s) => s.kind === "static");
  const conns = secrets.filter((s) => s.kind === "oauth");

  return (
    <>
      <h1 className="font-heading text-[27px] font-bold tracking-[-0.01em]">
        Secrets
      </h1>
      <p className="mt-1 text-[13.5px] text-ink-soft">
        API tokens and connected accounts your agent can use on your behalf.
      </p>

      <div className="mt-6 inline-flex rounded-[10px] border border-input bg-muted p-0.5">
        <SegBtn active={mode === "token"} onClick={() => setMode("token")}>
          <KeyRound className="size-[14px]" /> Token
        </SegBtn>
        <SegBtn active={mode === "oauth"} onClick={() => setMode("oauth")}>
          <Link2 className="size-[14px]" /> OAuth
        </SegBtn>
      </div>

      <div className="mt-5 flex flex-col gap-5">
        {mode === "token" ? (
          <>
            <TokenForm onDone={() => router.refresh()} />
            {tokens.length === 0 ? (
              <Empty>No API tokens yet.</Empty>
            ) : (
              <div className="flex flex-col gap-2">
                {tokens.map((s) => (
                  <StaticRow
                    key={s.id}
                    secret={s}
                    onChanged={() => router.refresh()}
                  />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <ConnectionForm providers={providers} redirectUri={redirectUri} />
            {conns.length === 0 ? (
              <Empty>No connected accounts yet.</Empty>
            ) : (
              <div className="flex flex-col gap-2">
                {conns.map((s) => (
                  <OAuthRow
                    key={s.id}
                    secret={s}
                    onChanged={() => router.refresh()}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

/* --------------------------------- layout --------------------------------- */

function SegBtn({
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
        "flex items-center gap-1.5 rounded-[8px] px-3.5 py-1.5 text-[13px] font-bold transition-colors",
        active
          ? "bg-background text-accent-text shadow-sm"
          : "text-ink-soft hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function FormCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[14px] border border-border bg-card p-5">
      <div className="mb-3.5 text-[14px] font-bold">{title}</div>
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-[12px] text-ink-soft">{label}</Label>
      {children}
      {hint && <p className="text-[11.5px] text-ink-faint">{hint}</p>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[12px] border border-dashed border-border px-4 py-6 text-center text-[13px] text-ink-faint">
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const map: Record<string, string> = {
    connected: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
    disconnected: "bg-muted text-ink-soft",
    expired: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  };
  const label =
    status === "connected"
      ? "Connected"
      : status === "expired"
        ? "Needs re-auth"
        : "Not connected";
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-bold",
        map[status ?? "disconnected"] ?? map.disconnected,
      )}
    >
      {label}
    </span>
  );
}

function PwInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Input
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={() => setShow((v) => !v)}
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </Button>
    </div>
  );
}

/* ---------------------------------- token ---------------------------------- */

function TokenForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await addStaticSecretAction({ name, description, value });
      toast.success("Token added");
      setName("");
      setDescription("");
      setValue("");
      onDone();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't add token");
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormCard title="Add token">
      <div className="flex flex-col gap-3">
        <Field label="Name" hint="e.g. STRIPE_API_KEY">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="STRIPE_API_KEY"
          />
        </Field>
        <Field label="Description" hint="Optional">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Stripe live secret key"
          />
        </Field>
        <Field label="Value">
          <PwInput value={value} onChange={setValue} placeholder="sk_live_…" />
        </Field>
        <Button
          onClick={submit}
          disabled={busy || !name.trim() || !value.trim()}
          className="knack-gradient w-fit font-bold text-white"
        >
          {busy ? <Spinner /> : <Plus className="size-4" />} Add token
        </Button>
      </div>
    </FormCard>
  );
}

function StaticRow({
  secret,
  onChanged,
}: {
  secret: SecretSummary;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (!confirm(`Delete token "${secret.name}"?`)) return;
    setBusy(true);
    try {
      await deleteSecretAction(secret.id);
      toast.success("Deleted");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't delete");
      setBusy(false);
    }
  }
  return (
    <div className="flex items-center gap-3 rounded-[12px] border border-border bg-card px-4 py-3">
      <KeyRound className="size-4 shrink-0 text-ink-faint" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-bold">{secret.name}</div>
        {secret.description && (
          <div className="truncate text-[12px] text-ink-soft">
            {secret.description}
          </div>
        )}
      </div>
      <span className="text-[13px] text-ink-faint">••••••••</span>
      <Button variant="ghost" size="icon-sm" onClick={remove} disabled={busy}>
        {busy ? <Spinner /> : <Trash2 className="size-4" />}
      </Button>
    </div>
  );
}

/* ---------------------------------- oauth ---------------------------------- */

function ConnectionForm({
  providers,
  redirectUri,
}: {
  providers: ProviderOption[];
  redirectUri: string;
}) {
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "google");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authUrl, setAuthUrl] = useState("");
  const [tokenUrl, setTokenUrl] = useState("");
  const [scopes, setScopes] = useState(
    (providers[0]?.defaultScopes ?? []).join(" "),
  );
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const selected = providers.find((p) => p.id === providerId);

  function onProvider(id: string) {
    setProviderId(id);
    const p = providers.find((x) => x.id === id);
    setScopes((p?.defaultScopes ?? []).join(" "));
  }

  async function copyRedirect() {
    await navigator.clipboard.writeText(redirectUri);
    setCopied(true);
    toast.success("Redirect URI copied");
    setTimeout(() => setCopied(false), 1500);
  }

  async function submit() {
    setBusy(true);
    try {
      const { id } = await addOAuthConnectionAction({
        name,
        description,
        provider: providerId,
        clientId,
        clientSecret,
        authUrl: selected?.custom ? authUrl : undefined,
        tokenUrl: selected?.custom ? tokenUrl : undefined,
        scopes: scopes.split(/\s+/).filter(Boolean),
      });
      const { url } = await startConnectAction(id);
      window.location.href = url; // hand off to the provider's consent screen
    } catch (e) {
      toast.error((e as Error).message || "Couldn't create connection");
      setBusy(false);
    }
  }

  const canSubmit =
    !!name.trim() &&
    !!clientId.trim() &&
    !!clientSecret.trim() &&
    (!selected?.custom || (!!authUrl.trim() && !!tokenUrl.trim()));

  return (
    <FormCard title="Connect account">
      <div className="flex flex-col gap-3">
        <Field label="Provider">
          <Select value={providerId} onValueChange={onProvider}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {providers.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected?.hint && (
            <p className="text-[11.5px] text-ink-faint">{selected.hint}</p>
          )}
        </Field>

        <Field
          label="Redirect URI"
          hint="Register this exact URL in your provider's console"
        >
          <div className="flex items-center gap-2">
            <Input readOnly value={redirectUri} className="text-[13px]" />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={copyRedirect}
              title="Copy"
            >
              {copied ? (
                <Check className="size-4 text-emerald-500" />
              ) : (
                <Copy className="size-4" />
              )}
            </Button>
          </div>
        </Field>

        <Field label="Name" hint="e.g. GOOGLE_DRIVE">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="GOOGLE_DRIVE"
          />
        </Field>
        <Field label="Description" hint="Optional">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="My Google Drive"
          />
        </Field>

        {selected?.custom && (
          <>
            <Field label="Authorization URL">
              <Input
                value={authUrl}
                onChange={(e) => setAuthUrl(e.target.value)}
                placeholder="https://provider.com/oauth/authorize"
                className="text-[13px]"
              />
            </Field>
            <Field label="Token URL">
              <Input
                value={tokenUrl}
                onChange={(e) => setTokenUrl(e.target.value)}
                placeholder="https://provider.com/oauth/token"
                className="text-[13px]"
              />
            </Field>
          </>
        )}

        <Field label="Client ID">
          <Input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
        </Field>
        <Field label="Client Secret">
          <PwInput value={clientSecret} onChange={setClientSecret} />
        </Field>
        <Field label="Scopes" hint="Space-separated. Edit to add or remove access.">
          <Input
            value={scopes}
            onChange={(e) => setScopes(e.target.value)}
            placeholder="openid email profile"
            className="text-[13px]"
          />
        </Field>

        <Button
          onClick={submit}
          disabled={busy || !canSubmit}
          className="knack-gradient w-fit font-bold text-white"
        >
          {busy ? <Spinner /> : <Link2 className="size-4" />} Save & connect
        </Button>
      </div>
    </FormCard>
  );
}

function OAuthRow({
  secret,
  onChanged,
}: {
  secret: SecretSummary;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<null | "connect" | "disconnect" | "delete">(
    null,
  );

  async function reauth() {
    setBusy("connect");
    try {
      const { url } = await startConnectAction(secret.id);
      window.location.href = url;
    } catch (e) {
      toast.error((e as Error).message || "Couldn't start connection");
      setBusy(null);
    }
  }
  async function disconnect() {
    setBusy("disconnect");
    try {
      await disconnectAction(secret.id);
      toast.success("Disconnected");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't disconnect");
      setBusy(null);
    }
  }
  async function remove() {
    if (!confirm(`Delete connection "${secret.name}"?`)) return;
    setBusy("delete");
    try {
      await deleteSecretAction(secret.id);
      toast.success("Deleted");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't delete");
      setBusy(null);
    }
  }

  const connected = secret.status === "connected";

  return (
    <div className="flex items-center gap-3 rounded-[12px] border border-border bg-card px-4 py-3">
      <Link2 className="size-4 shrink-0 text-ink-faint" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-bold">{secret.name}</span>
          <span className="text-[11.5px] text-ink-faint">{secret.provider}</span>
          <StatusBadge status={secret.status} />
        </div>
        <div className="truncate text-[12px] text-ink-soft">
          {secret.accountEmail ??
            secret.description ??
            (secret.scopes?.length
              ? secret.scopes.join(" ")
              : "Not yet authorized")}
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={reauth} disabled={busy !== null}>
        {busy === "connect" ? <Spinner /> : <RefreshCw className="size-3.5" />}
        {connected ? "Re-auth" : "Connect"}
      </Button>
      {connected && (
        <Button
          variant="ghost"
          size="icon-sm"
          title="Disconnect"
          onClick={disconnect}
          disabled={busy !== null}
        >
          {busy === "disconnect" ? <Spinner /> : <Unplug className="size-4" />}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        title="Delete"
        onClick={remove}
        disabled={busy !== null}
      >
        {busy === "delete" ? <Spinner /> : <Trash2 className="size-4" />}
      </Button>
    </div>
  );
}
