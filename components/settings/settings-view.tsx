"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { X, Sun, Moon, LogOut } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Logomark } from "@/components/brand/logo";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { authClient, signOut } from "@/lib/auth-client";
import { SecretsTab } from "@/components/settings/secrets-tab";
import type { ProviderOption } from "@/components/settings/secrets-tab";
import { ProjectsTab } from "@/components/settings/projects-tab";
import type { SecretSummary } from "@/lib/user-secrets";
import type { GithubAccountSummary } from "@/lib/github-account";
import type { ProjectSummary } from "@/lib/projects";

const TABS = ["Account", "Projects", "Secrets", "Appearance"] as const;
type Tab = (typeof TABS)[number];

export function SettingsView({
  name,
  email,
  secrets,
  redirectUri,
  providers,
  githubAccount,
  projects,
}: {
  name: string;
  email: string;
  secrets: SecretSummary[];
  redirectUri: string;
  providers: ProviderOption[];
  githubAccount: GithubAccountSummary | null;
  projects: ProjectSummary[];
}) {
  const params = useSearchParams();
  const tabParam = params.get("tab");
  const [tab, setTab] = useState<Tab>(
    TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "Account",
  );

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
        <Logomark size={22} />
        <span className="text-[14.5px] font-bold">Settings</span>
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
          <div className="max-w-[620px]">
            {tab === "Account" && <AccountTab name={name} email={email} />}
            {tab === "Projects" && (
              <ProjectsTab account={githubAccount} projects={projects} />
            )}
            {tab === "Secrets" && (
              <SecretsTab
                secrets={secrets}
                redirectUri={redirectUri}
                providers={providers}
              />
            )}
            {tab === "Appearance" && <AppearanceTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

function AccountTab({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  return (
    <>
      <h1 className="font-heading text-[27px] font-medium tracking-[-0.01em]">
        Account
      </h1>
      <p className="mt-1 text-[13.5px] text-ink-soft">
        Update your name, email, and password.
      </p>

      <div className="mt-7 flex flex-col gap-4">
        <NameCard initial={name} />
        <EmailCard initial={email} />
        <PasswordCard />

        <Button
          variant="outline"
          onClick={async () => {
            await signOut();
            router.push("/login");
            router.refresh();
          }}
          className="mt-1 w-fit"
        >
          <LogOut className="size-4" /> Log out
        </Button>
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
    <div className="rounded-[14px] border border-border bg-card p-5">
      <div className="mb-3.5">
        <div className="text-[14px] font-bold">{title}</div>
        {desc && <div className="mt-0.5 text-[12.5px] text-ink-soft">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

function NameCard({ initial }: { initial: string }) {
  const router = useRouter();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim() || name.trim() === initial) return;
    setBusy(true);
    try {
      const res = await authClient.updateUser({ name: name.trim() });
      if (res.error) throw new Error(res.error.message);
      toast.success("Name updated");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't update name");
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormCard title="Name">
      <div className="flex items-center gap-2.5">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          className="max-w-[320px]"
        />
        <Button
          onClick={save}
          disabled={busy || !name.trim() || name.trim() === initial}
          className="knack-gradient h-9 px-4 font-bold text-white"
        >
          {busy ? <Spinner /> : "Save"}
        </Button>
      </div>
    </FormCard>
  );
}

function EmailCard({ initial }: { initial: string }) {
  const [email, setEmail] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function save() {
    const next = email.trim().toLowerCase();
    if (!next || next === initial.toLowerCase()) return;
    setBusy(true);
    try {
      const res = await authClient.changeEmail({
        newEmail: next,
        callbackURL: "/settings",
      });
      if (res.error) throw new Error(res.error.message);
      toast.success(
        "Email change requested — check your inbox to confirm if prompted.",
      );
    } catch (e) {
      toast.error((e as Error).message || "Couldn't change email");
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormCard
      title="Email"
      desc="If your current email is verified, we'll send a confirmation link to the new address."
    >
      <div className="flex items-center gap-2.5">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="max-w-[320px]"
          autoComplete="email"
        />
        <Button
          onClick={save}
          disabled={busy || !email.trim() || email.trim().toLowerCase() === initial.toLowerCase()}
          className="knack-gradient h-9 px-4 font-bold text-white"
        >
          {busy ? <Spinner /> : "Update"}
        </Button>
      </div>
    </FormCard>
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (current.length < 8 || next.length < 8) {
      toast.error("Passwords must be at least 8 characters");
      return;
    }
    setBusy(true);
    try {
      const res = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: true,
      });
      if (res.error) throw new Error(res.error.message);
      setCurrent("");
      setNext("");
      toast.success("Password updated");
    } catch (e) {
      toast.error((e as Error).message || "Couldn't change password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormCard title="Password" desc="Use at least 8 characters.">
      <div className="flex max-w-[320px] flex-col gap-2.5">
        <div className="grid gap-1.5">
          <Label htmlFor="current" className="text-[12px] text-ink-soft">
            Current password
          </Label>
          <Input
            id="current"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            placeholder="••••••••"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="new" className="text-[12px] text-ink-soft">
            New password
          </Label>
          <Input
            id="new"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            autoComplete="new-password"
            placeholder="••••••••"
          />
        </div>
        <Button
          onClick={save}
          disabled={busy || !current || !next}
          className="knack-gradient mt-1 h-9 w-fit px-4 font-bold text-white"
        >
          {busy ? <Spinner /> : "Change password"}
        </Button>
      </div>
    </FormCard>
  );
}

function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  return (
    <>
      <h1 className="font-heading text-[27px] font-medium tracking-[-0.01em]">
        Appearance
      </h1>
      <p className="mt-1 text-[13.5px] text-ink-soft">Choose how Knack looks.</p>
      <div className="mt-6 flex gap-3">
        <ThemeCard
          active={theme !== "dark"}
          onClick={() => setTheme("light")}
          icon={<Sun className="size-5" />}
          label="Light"
        />
        <ThemeCard
          active={theme === "dark"}
          onClick={() => setTheme("dark")}
          icon={<Moon className="size-5" />}
          label="Dark"
        />
      </div>
    </>
  );
}

function ThemeCard({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex h-24 w-32 flex-col items-center justify-center gap-2 rounded-xl border-[1.5px] transition-colors",
        active
          ? "border-primary bg-sidebar-accent text-accent-text"
          : "border-border bg-card text-ink-soft hover:bg-accent",
      )}
    >
      {icon}
      <span className="text-[13px] font-bold">{label}</span>
    </button>
  );
}
