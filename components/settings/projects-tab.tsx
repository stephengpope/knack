"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  Eye,
  EyeOff,
  GitBranch,
  Unplug,
  FolderGit2,
  Star,
  ExternalLink,
  Lock,
  Globe,
  Link2,
  Sparkles,
  ChevronsUpDown,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { GithubAccountSummary } from "@/lib/github-account";
import type { ProjectSummary } from "@/lib/projects";
import type { RepoListItem } from "@/lib/github";
import {
  connectGithubAction,
  disconnectGithubAction,
  createProjectAction,
  addExistingProjectAction,
  listReposAction,
  setDefaultProjectAction,
  setProjectActiveAction,
  deleteProjectAction,
} from "@/app/(app)/settings/project-actions";

export function ProjectsTab({
  account,
  projects,
}: {
  account: GithubAccountSummary | null;
  projects: ProjectSummary[];
}) {
  const router = useRouter();
  const refresh = () => router.refresh();

  return (
    <>
      <h1 className="font-heading text-[27px] font-bold tracking-[-0.01em]">
        Projects
      </h1>
      <p className="mt-1 text-[13.5px] text-ink-soft">
        Connect GitHub, then create projects your agent can work in. Each project
        is its own repository.
      </p>

      <div className="mt-6 flex flex-col gap-5">
        <GithubCard account={account} onChanged={refresh} />
        {account ? (
          <ProjectsSection projects={projects} onChanged={refresh} />
        ) : (
          <Empty>Connect a GitHub account above to create projects.</Empty>
        )}
      </div>
    </>
  );
}

/* --------------------------------- layout --------------------------------- */

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

/* --------------------------------- github --------------------------------- */

function GithubCard({
  account,
  onChanged,
}: {
  account: GithubAccountSummary | null;
  onChanged: () => void;
}) {
  const [pat, setPat] = useState("");
  const [busy, setBusy] = useState(false);

  async function connect() {
    setBusy(true);
    try {
      const { login } = await connectGithubAction({ pat });
      toast.success(`Connected as ${login}`);
      setPat("");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't connect GitHub");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect GitHub? Existing projects stay, but the agent " +
      "won't be able to access their repos until you reconnect.")) return;
    setBusy(true);
    try {
      await disconnectGithubAction();
      toast.success("Disconnected");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't disconnect");
    } finally {
      setBusy(false);
    }
  }

  if (account) {
    return (
      <div className="flex items-center gap-3 rounded-[14px] border border-border bg-card px-5 py-4">
        <GitBranch className="size-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-bold">GitHub connected</div>
          <div className="truncate text-[12.5px] text-ink-soft">
            @{account.login}
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={disconnect} disabled={busy}>
          {busy ? <Spinner /> : <Unplug className="size-3.5" />} Disconnect
        </Button>
      </div>
    );
  }

  return (
    <FormCard title="Connect GitHub">
      <div className="flex flex-col gap-3">
        <Field label="Personal access token">
          <PwInput value={pat} onChange={setPat} placeholder="ghp_…" />
          <p className="text-[11.5px] text-ink-faint">
            Create a{" "}
            <a
              href="https://github.com/settings/tokens/new?scopes=repo&description=Knack"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 font-semibold text-primary hover:underline"
            >
              classic token with the <span className="font-mono">repo</span> scope
              <ExternalLink className="size-3" />
            </a>
            , which lets Knack create repositories and read/write their contents.
          </p>
        </Field>
        <Button
          onClick={connect}
          disabled={busy || !pat.trim()}
          className="knack-gradient w-fit font-bold text-white"
        >
          {busy ? <Spinner /> : <GitBranch className="size-4" />} Connect
        </Button>
      </div>
    </FormCard>
  );
}

/* -------------------------------- projects -------------------------------- */

function ProjectsSection({
  projects,
  onChanged,
}: {
  projects: ProjectSummary[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "existing">("create");

  function done() {
    setOpen(false);
    onChanged();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-[14px] font-bold">Your projects</div>
        <Button
          size="sm"
          onClick={() => setOpen(true)}
          className="knack-gradient font-bold text-white"
        >
          <Plus className="size-4" /> Add project
        </Button>
      </div>

      {projects.length === 0 ? (
        <Empty>No projects yet. Create one to give your agent a repo.</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {projects.map((p) => (
            <ProjectRow key={p.id} project={p} onChanged={onChanged} />
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add project</DialogTitle>
            <DialogDescription>
              {mode === "create"
                ? "Create a new GitHub repository from the Knack template."
                : "Link an existing GitHub repository as a project."}
            </DialogDescription>
          </DialogHeader>

          <div className="inline-flex w-full rounded-[10px] border border-input bg-muted p-0.5">
            <VisBtn
              active={mode === "create"}
              onClick={() => setMode("create")}
              icon={<Sparkles className="size-[13px]" />}
              label="Create new"
              className="flex-1 justify-center"
            />
            <VisBtn
              active={mode === "existing"}
              onClick={() => setMode("existing")}
              icon={<Link2 className="size-[13px]" />}
              label="Add existing"
              className="flex-1 justify-center"
            />
          </div>

          {mode === "create" ? (
            <CreateProjectForm onDone={done} />
          ) : (
            <AddExistingForm onDone={done} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateProjectForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [repoName, setRepoName] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [busy, setBusy] = useState(false);
  // Track whether the user has hand-edited the repo name; until then, derive it.
  const [repoTouched, setRepoTouched] = useState(false);

  function slugify(v: string) {
    return v
      .toLowerCase()
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100);
  }

  function onName(v: string) {
    setName(v);
    if (!repoTouched) setRepoName(slugify(v));
  }

  async function submit() {
    setBusy(true);
    try {
      const p = await createProjectAction({ name, repoName, private: isPrivate });
      toast.success(`Created ${p.repoFullName}`);
      setName("");
      setRepoName("");
      setRepoTouched(false);
      onDone();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't create project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label="Name" hint="A friendly name for this project.">
        <Input
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="Marketing Site"
          autoFocus
        />
      </Field>
      <Field label="Repository name" hint="The GitHub repo we'll create.">
        <Input
          value={repoName}
          onChange={(e) => {
            setRepoTouched(true);
            setRepoName(e.target.value);
          }}
          placeholder="marketing-site"
          className="font-mono text-[13px]"
        />
      </Field>
      <div className="inline-flex w-fit rounded-[10px] border border-input bg-muted p-0.5">
        <VisBtn
          active={isPrivate}
          onClick={() => setIsPrivate(true)}
          icon={<Lock className="size-[13px]" />}
          label="Private"
        />
        <VisBtn
          active={!isPrivate}
          onClick={() => setIsPrivate(false)}
          icon={<Globe className="size-[13px]" />}
          label="Public"
        />
      </div>
      <Button
        onClick={submit}
        disabled={busy || !name.trim() || !repoName.trim()}
        className="knack-gradient mt-1 w-full font-bold text-white"
      >
        {busy ? <Spinner /> : <Plus className="size-4" />} Create project
      </Button>
    </div>
  );
}

function AddExistingForm({ onDone }: { onDone: () => void }) {
  const [repos, setRepos] = useState<RepoListItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [repo, setRepo] = useState(""); // chosen "owner/repo"
  const [name, setName] = useState("");
  // Until the user edits Name, keep deriving it from the picked repo.
  const [nameTouched, setNameTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    listReposAction()
      .then((r) => alive && setRepos(r))
      .catch((e) => alive && setLoadError((e as Error).message));
    return () => {
      alive = false;
    };
  }, []);

  function pickRepo(fullName: string) {
    setRepo(fullName);
    if (!nameTouched) setName(fullName.split("/")[1] ?? fullName);
  }

  async function submit() {
    setBusy(true);
    try {
      const p = await addExistingProjectAction({
        repoFullName: repo,
        name: name.trim() || undefined,
      });
      toast.success(`Added ${p.repoFullName}`);
      onDone();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't add project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Field label="Name" hint="A friendly name for this project.">
        <Input
          value={name}
          onChange={(e) => {
            setNameTouched(true);
            setName(e.target.value);
          }}
          placeholder="Marketing Site"
          autoFocus
        />
      </Field>
      <Field label="Repository" hint="Pick one of your repos, or paste owner/repo.">
        <RepoCombobox
          repos={repos}
          loading={repos === null && !loadError}
          error={loadError}
          value={repo}
          onChange={pickRepo}
        />
      </Field>

      <Button
        onClick={submit}
        disabled={busy || !repo.trim()}
        className="knack-gradient mt-1 w-full font-bold text-white"
      >
        {busy ? <Spinner /> : <Link2 className="size-4" />} Add project
      </Button>
    </div>
  );
}

// "owner/repo" — used to offer a paste-through for repos not in the loaded list.
const OWNER_REPO_RE = /^[\w.-]+\/[\w.-]+$/;

function RepoCombobox({
  repos,
  loading,
  error,
  value,
  onChange,
}: {
  repos: RepoListItem[] | null;
  loading: boolean;
  error: string | null;
  value: string;
  onChange: (fullName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const typed = query.trim();
  const canPaste =
    OWNER_REPO_RE.test(typed) &&
    !(repos ?? []).some((r) => r.fullName.toLowerCase() === typed.toLowerCase());

  function pick(fullName: string) {
    onChange(fullName);
    setQuery("");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between px-3 font-mono text-[13px] font-normal"
        >
          <span className={cn("truncate", !value && "text-ink-faint")}>
            {value || "Select a repository…"}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-0"
      >
        <Command>
          <CommandInput
            placeholder="Search or paste owner/repo…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-[12.5px] text-ink-faint">
                <Spinner /> Loading repos…
              </div>
            ) : error ? (
              <div className="px-3 py-4 text-center text-[12px] text-ink-faint">
                Couldn&apos;t load repos: {error}. Paste owner/repo above.
              </div>
            ) : (
              <>
                <CommandEmpty>
                  {canPaste ? (
                    <button
                      type="button"
                      onClick={() => pick(typed)}
                      className="mx-auto flex items-center gap-1.5 text-[13px] hover:text-foreground"
                    >
                      Use <span className="font-mono">{typed}</span>
                    </button>
                  ) : (
                    "No repositories found."
                  )}
                </CommandEmpty>
                <CommandGroup>
                  {(repos ?? []).map((r) => (
                    <CommandItem
                      key={r.fullName}
                      value={r.fullName}
                      onSelect={() => pick(r.fullName)}
                    >
                      <FolderGit2 className="size-3.5 shrink-0 text-ink-faint" />
                      <span className="flex-1 truncate font-mono">
                        {r.fullName}
                      </span>
                      {r.private && (
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-bold text-ink-faint">
                          Private
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function VisBtn({
  active,
  onClick,
  icon,
  label,
  className,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[12.5px] font-bold transition-colors",
        active
          ? "bg-background text-accent-text shadow-sm"
          : "text-ink-soft hover:text-foreground",
        className,
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function ProjectRow({
  project,
  onChanged,
}: {
  project: ProjectSummary;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<null | "default" | "active" | "delete">(null);

  async function makeDefault() {
    setBusy("default");
    try {
      await setDefaultProjectAction(project.id);
      toast.success(`${project.name} is now the default`);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't set default");
      setBusy(null);
    }
  }

  async function toggleActive() {
    setBusy("active");
    try {
      await setProjectActiveAction(project.id, !project.active);
      toast.success(
        project.active ? `${project.name} deactivated` : `${project.name} activated`,
      );
      onChanged();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't change active state");
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm(`Remove project "${project.name}"? The GitHub repo is kept.`))
      return;
    setBusy("delete");
    try {
      await deleteProjectAction(project.id);
      toast.success("Removed");
      onChanged();
    } catch (e) {
      toast.error((e as Error).message || "Couldn't remove");
      setBusy(null);
    }
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-[12px] border border-border bg-card px-4 py-3",
        !project.active && "opacity-60",
      )}
    >
      <FolderGit2 className="size-4 shrink-0 text-ink-faint" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-bold">{project.name}</span>
          {project.isDefault && (
            <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-bold text-primary">
              Default
            </span>
          )}
          {!project.active && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-ink-faint">
              Inactive
            </span>
          )}
        </div>
        <a
          href={project.htmlUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 truncate font-mono text-[12px] text-ink-soft hover:text-foreground"
        >
          {project.repoFullName}
          <ExternalLink className="size-3" />
        </a>
      </div>
      {!project.isDefault && (
        <Button
          variant="outline"
          size="sm"
          onClick={makeDefault}
          disabled={busy !== null}
          title="Set as default"
        >
          {busy === "default" ? <Spinner /> : <Star className="size-3.5" />}
          Default
        </Button>
      )}
      <Switch
        checked={project.active}
        onCheckedChange={toggleActive}
        disabled={busy !== null}
        aria-label={project.active ? "Deactivate project" : "Activate project"}
        title={
          project.active
            ? "Active — switch off to pause cron and hide from new chats"
            : "Inactive — switch on to activate"
        }
      />
      <Button
        variant="ghost"
        size="icon-sm"
        title="Remove"
        onClick={remove}
        disabled={busy !== null}
      >
        {busy === "delete" ? <Spinner /> : <Trash2 className="size-4" />}
      </Button>
    </div>
  );
}
