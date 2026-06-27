"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { useConfirm } from "@/components/app/confirm";
import {
  connectTelegramAction,
  disconnectTelegramAction,
} from "@/app/(app)/telegram/actions";
import type { TelegramAccountSummary } from "@/lib/telegram-account";

export function TelegramTab({
  account,
  voiceConfigured,
}: {
  account: TelegramAccountSummary | null;
  voiceConfigured: boolean;
}) {
  return (
    <>
      <h1 className="font-heading text-3xl font-bold tracking-snug">
        Telegram
      </h1>
      <p className="mt-1 text-sm text-ink-soft">
        Chat with your agent from Telegram. Connect a bot you create with
        @BotFather and lock it to your own Telegram account.
      </p>

      <div className="mt-7">
        {account ? (
          <Connected account={account} voiceConfigured={voiceConfigured} />
        ) : (
          <ConnectForm />
        )}
      </div>
    </>
  );
}

function FormCard({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-3.5 flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-telegram text-white">
          <Send className="size-5" strokeWidth={2} />
        </span>
        <div>
          <div className="text-sm font-bold">{title}</div>
          {desc && (
            <div className="mt-0.5 text-xs text-ink-soft">{desc}</div>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

function Connected({
  account,
  voiceConfigured,
}: {
  account: TelegramAccountSummary;
  voiceConfigured: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

  async function disconnect() {
    if (
      !(await confirm({
        title: "Disconnect Telegram?",
        description:
          "Knack will stop sending and receiving Telegram messages for your account.",
        confirmLabel: "Disconnect",
      }))
    )
      return;
    setBusy(true);
    try {
      await disconnectTelegramAction();
      toast.success("Telegram disconnected");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormCard title="Connected" desc="Your bot is linked and ready.">
      <div className="space-y-3.5">
        <Row label="Bot">
          {account.botUsername ? `@${account.botUsername}` : "—"}
        </Row>
        <Row label="Authorized user">{account.authorizedTgUserId}</Row>
        <Row label="Voice">
          {voiceConfigured
            ? "On (transcribes voice notes)"
            : "Off (admin sets the AssemblyAI key)"}
        </Row>
        <p className="text-xs text-ink-soft">
          Open Telegram and send your bot a message. Use{" "}
          <code className="rounded bg-muted px-1">/help</code> to see commands.
        </p>
        <Button
          variant="outline"
          onClick={disconnect}
          disabled={busy}
          className="text-destructive"
        >
          {busy && <Spinner />}
          Disconnect
        </Button>
      </div>
    </FormCard>
  );
}

function ConnectForm() {
  const [token, setToken] = useState("");
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    try {
      const { username } = await connectTelegramAction(token, userId);
      toast.success(username ? `Connected @${username}` : "Telegram connected");
      setToken("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormCard title="Connect a bot" desc="Takes about a minute to set up.">
      <div className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="tg-token">Bot token</Label>
          <Input
            id="tg-token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="123456:ABC-DEF..."
            autoComplete="off"
          />
          <p className="text-xs text-ink-soft">
            Create a bot with @BotFather and paste its token.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tg-user">Your Telegram user ID</Label>
          <Input
            id="tg-user"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="123456789"
            inputMode="numeric"
          />
          <p className="text-xs text-ink-soft">
            Message @userinfobot on Telegram to get your numeric ID. Only this
            user can talk to the bot.
          </p>
        </div>

        <Button onClick={connect} disabled={busy || !token || !userId}>
          {busy && <Spinner />}
          Connect
        </Button>
      </div>
    </FormCard>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-ink-soft">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}
