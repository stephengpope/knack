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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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

  // Surface the OAuth callback outcome, then strip the query params.
  useEffect(() => {
    const connected = params.get("connected");
    const error = params.get("error");
    if (connected) toast.success(`Connected ${connected}`);
    else if (error) toast.error(oauthErrorMessage(error));
    if (connected || error) router.replace("/settings?tab=Secrets");
  }, [params, router]);

  const staticSecrets = secrets.filter((s) => s.kind === "static");
  const oauthSecrets = secrets.filter((s) => s.kind === "oauth");

  return (
    <>
      <h1 className="font-heading text-[27px] font-medium tracking-[-0.01em]">
        Secrets
      </h1>
      <p className="mt-1 text-[13.5px] text-ink-soft">
        API keys and connected accounts your agent can use on your behalf.
      </p>

      <Section
        title="API Secrets"
        desc="Plain values (API keys, tokens) the agent can fetch by name."
        action={<AddStaticDialog onDone={() => router.refresh()} />}
      >
        {staticSecrets.length === 0 ? (
          <Empty>No API secrets yet.</Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {staticSecrets.map((s) => (
              <StaticRow key={s.id} secret={s} onChanged={() => router.refresh()} />
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Connected Accounts"
        desc="OAuth connections. You supply the client ID/secret; we store the granted tokens and refresh them automatically."
        action={
          <AddConnectionDialog
            providers={providers}
            redirectUri={redirectUri}
          />
        }
      >
        {oauthSecrets.length === 0 ? (
          <Empty>No connected accounts yet.</Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {oauthSecrets.map((s) => (
              <OAuthRow key={s.id} secret={s} onChanged={() => router.refresh()} />
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

/* --------------------------------- layout --------------------------------- */

function Section({
  title,
  desc,
  action,
  children,
}: {
  title: string;
  desc: string;
  action: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-8">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-bold">{title}</div>
          <div className="mt-0.5 max-w-[440px] text-[12.5px] text-ink-soft">
            {desc}
          </div>
        </div>
        {action}
      </div>
      {children}
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

/* --------------------------------- static --------------------------------- */

function StaticRow({
  secret,
  onChanged,
}: {
  secret: SecretSummary;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function remove() {
    if (!confirm(`Delete secret "${secret.name}"?`)) return;
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
      <span className="font-mono text-[13px] text-ink-faint">••••••••</span>
      <Button variant="ghost" size="icon-sm" onClick={remove} disabled={busy}>
        {busy ? <Spinner /> : <Trash2 className="size-4" />}
      </Button>
    </div>
  );
}

function AddStaticDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  function reset() {
    setName("");
    setDescription("");
    setValue("");
    setShow(false);
  }

  async function submit() {
    setBusy(true);
    try {
      await addStaticSecretAction({ name, description, value });
      toast.success("Secret added");
      setOpen(false);
      reset();
      onDone();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't add secret");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        size="sm"
        className="knack-gradient shrink-0 font-bold text-white"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-4" /> Add secret
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add API secret</DialogTitle>
          <DialogDescription>
            Stored encrypted. The agent fetches it by name with get_token.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field label="Name" hint="e.g. STRIPE_API_KEY">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="STRIPE_API_KEY"
              autoFocus
            />
          </Field>
          <Field label="Description" hint="Optional — helps the agent know its purpose">
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Stripe live secret key"
            />
          </Field>
          <Field label="Value">
            <div className="flex items-center gap-2">
              <Input
                type={show ? "text" : "password"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="sk_live_…"
                className="font-mono"
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
          </Field>
          <Button
            onClick={submit}
            disabled={busy || !name.trim() || !value.trim()}
            className="knack-gradient mt-1 font-bold text-white"
          >
            {busy ? <Spinner /> : "Add secret"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------- oauth ---------------------------------- */

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
          <span className="text-[11.5px] text-ink-faint">
            {secret.provider}
          </span>
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
      <Button
        variant="outline"
        size="sm"
        onClick={reauth}
        disabled={busy !== null}
      >
        {busy === "connect" ? (
          <Spinner />
        ) : (
          <RefreshCw className="size-3.5" />
        )}
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

function AddConnectionDialog({
  providers,
  redirectUri,
}: {
  providers: ProviderOption[];
  redirectUri: string;
}) {
  const [open, setOpen] = useState(false);
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "google");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
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
      // hand off to the provider's consent screen
      const { url } = await startConnectAction(id);
      window.location.href = url;
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
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        size="sm"
        className="knack-gradient shrink-0 font-bold text-white"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-4" /> Connect account
      </Button>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect an account</DialogTitle>
          <DialogDescription>
            Register the redirect URI below in your provider, then paste your
            OAuth client credentials.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
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
              <p className="mt-1 text-[11.5px] text-ink-faint">{selected.hint}</p>
            )}
          </Field>

          <Field label="Redirect URI" hint="Register this exact URL in your provider's console">
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
              className="text-[13px]"
            />
          </Field>
          <Field label="Client Secret">
            <div className="flex items-center gap-2">
              <Input
                type={showSecret ? "text" : "password"}
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                className="text-[13px]"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setShowSecret((v) => !v)}
              >
                {showSecret ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </Button>
            </div>
          </Field>
          <Field label="Scopes" hint="Space-separated. Edit to add or remove access.">
            <Input
              value={scopes}
              onChange={(e) => setScopes(e.target.value)}
              placeholder="openid email profile"
              className="text-[13px]"
            />
          </Field>
        </div>

        <Button
          onClick={submit}
          disabled={busy || !canSubmit}
          className="knack-gradient font-bold text-white"
        >
          {busy ? <Spinner /> : "Save & connect"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------- shared --------------------------------- */

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
