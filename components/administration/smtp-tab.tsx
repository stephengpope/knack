"use client";

import { useState } from "react";
import { Mail, Check, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import type { SmtpSettings } from "@/lib/settings";
import {
  setSmtpAction,
  deleteSmtpAction,
  testSmtpAction,
} from "@/app/(app)/administration/actions";

export function SmtpTab({ smtp }: { smtp: SmtpSettings }) {
  const [enabled, setEnabled] = useState(smtp.enabled);
  const [host, setHost] = useState(smtp.host ?? "");
  const [port, setPort] = useState(String(smtp.port ?? 587));
  const [secure, setSecure] = useState(smtp.secure);
  const [user, setUser] = useState(smtp.user ?? "");
  const [pass, setPass] = useState("");
  const [from, setFrom] = useState(smtp.from ?? "");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const configured = Boolean(smtp.host && smtp.from);

  function input(): {
    enabled: boolean;
    host: string;
    port: number;
    secure: boolean;
    user: string | null;
    pass: string;
    from: string;
  } {
    return {
      enabled,
      host: host.trim(),
      port: Number(port) || 587,
      secure,
      user: user.trim() || null,
      pass, // blank keeps the stored password
      from: from.trim(),
    };
  }

  // Switching encryption nudges the conventional port (465 implicit TLS / 587 STARTTLS)
  // unless the admin set a non-standard one.
  function setEncryption(useSsl: boolean) {
    setSecure(useSsl);
    if (port === "587" || port === "465" || !port.trim()) {
      setPort(useSsl ? "465" : "587");
    }
  }

  async function save() {
    setBusy(true);
    try {
      await setSmtpAction(input());
      setPass("");
      toast.success("Email settings saved");
    } catch (e) {
      toast.error((e as Error).message || "Could not save settings");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      const err = await testSmtpAction(input());
      if (err) toast.error(`Connection failed: ${err}`);
      else toast.success("SMTP connection succeeded");
    } catch (e) {
      toast.error((e as Error).message || "Could not test connection");
    } finally {
      setTesting(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await deleteSmtpAction();
      setEnabled(false);
      setHost("");
      setPort("587");
      setSecure(false);
      setUser("");
      setPass("");
      setFrom("");
      toast.success("Email settings cleared");
    } catch {
      toast.error("Could not clear settings");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="font-heading text-3xl font-bold tracking-snug">
        Email
      </h1>
      <p className="mt-1 text-sm text-ink-soft">
        Connect an SMTP server to send password-reset and invite emails. When
        disabled, invites surface a copyable link and the “Forgot password?” link
        is hidden.
      </p>

      {/* Master switch */}
      <div className="mt-7 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3.5">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full",
            enabled
              ? "bg-success-soft text-success"
              : "bg-muted text-ink-faint",
          )}
        >
          <Mail className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">Email sending</div>
          <div className="text-xs text-ink-soft">
            {enabled
              ? "Reset and invite emails are delivered via SMTP."
              : "Email is off — links must be shared manually."}
          </div>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      <SectionLabel className="mt-7">SMTP server</SectionLabel>
      <div className="flex flex-col gap-3">
        <Field label="Host">
          <Input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="smtp.example.com"
            autoComplete="off"
          />
        </Field>

        <div className="grid grid-cols-[120px_1fr] gap-3">
          <Field label="Port">
            <Input
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="587"
              autoComplete="off"
            />
          </Field>
          <Field label="Encryption">
            <div className="inline-flex rounded-md border border-input bg-muted/50 p-0.5">
              <SegBtn active={!secure} onClick={() => setEncryption(false)}>
                STARTTLS
              </SegBtn>
              <SegBtn active={secure} onClick={() => setEncryption(true)}>
                SSL/TLS
              </SegBtn>
            </div>
          </Field>
        </div>

        <Field label="Username">
          <Input
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="Often your full email address"
            autoComplete="off"
          />
        </Field>

        <Field label="Password">
          <Input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder={
              smtp.passLast4
                ? `Saved ••••${smtp.passLast4} — type a new password to replace`
                : "SMTP password or app password"
            }
            autoComplete="off"
          />
        </Field>

        <Field label="From address">
          <Input
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="Knack <noreply@yourdomain.com>"
            autoComplete="off"
          />
        </Field>
      </div>

      <div className="mt-5 flex items-center gap-2">
        <Button
          onClick={save}
          disabled={busy || testing}
          className="knack-gradient h-9 px-4 font-bold text-white"
        >
          {busy ? <Spinner /> : "Save"}
        </Button>
        <Button
          variant="outline"
          onClick={test}
          disabled={testing || busy || !host.trim()}
          className="h-9 px-4 font-semibold"
        >
          {testing ? (
            <Spinner />
          ) : (
            <>
              <ShieldCheck className="size-4" /> Test connection
            </>
          )}
        </Button>
        {configured && (
          <Button
            variant="ghost"
            onClick={clear}
            disabled={busy || testing}
            className="ml-auto h-9 px-3 text-sm font-semibold text-ink-soft hover:text-foreground"
          >
            Clear
          </Button>
        )}
      </div>
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <label className="text-xs font-semibold text-ink-soft">
        {label}
      </label>
      {children}
    </div>
  );
}

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
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm font-semibold transition-colors",
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-ink-soft hover:text-foreground",
      )}
    >
      {active && <Check className="size-3.5" strokeWidth={3} />}
      {children}
    </button>
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
        "mb-3 text-xs font-bold uppercase tracking-label text-ink-faint",
        className,
      )}
    >
      {children}
    </div>
  );
}
