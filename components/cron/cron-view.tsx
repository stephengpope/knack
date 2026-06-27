"use client";

import Link from "next/link";
import { Clock, FolderGit2, ExternalLink, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CronProjectGroup } from "@/lib/cron/view";

function fmtUtc(iso: string): string {
  return (
    new Date(iso).toLocaleString("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }) + " UTC"
  );
}

function rel(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const m = 60_000,
    h = 3_600_000,
    d = 86_400_000;
  const unit = (n: number, u: string) => `${n} ${u}${n === 1 ? "" : "s"}`;
  let s: string;
  if (abs < h) s = unit(Math.max(1, Math.round(abs / m)), "min");
  else if (abs < d) s = unit(Math.round(abs / h), "hour");
  else s = unit(Math.round(abs / d), "day");
  return diff >= 0 ? `in ${s}` : `${s} ago`;
}

export function CronView({ groups }: { groups: CronProjectGroup[] }) {
  const totalJobs = groups.reduce((n, g) => n + g.jobs.length, 0);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-10">
      <div className="mx-auto max-w-195">
        <h1 className="font-heading text-3xl font-bold tracking-snug">
          Cron
        </h1>
        <p className="mt-1 text-sm text-ink-soft">
          {totalJobs} scheduled job{totalJobs === 1 ? "" : "s"} across{" "}
          {groups.length} active project{groups.length === 1 ? "" : "s"}. Schedules
          live in each project&apos;s <span className="font-mono">cron.json</span>;
          your agent manages them.
        </p>

        {groups.length === 0 ? (
          <Empty className="mt-6">
            No active projects. Activate a project in Settings to schedule runs.
          </Empty>
        ) : (
          <div className="mt-6 flex flex-col gap-7">
            {groups.map((g) => (
              <section key={g.projectId}>
                <div className="mb-2.5 flex items-center gap-2">
                  <FolderGit2 className="size-4 shrink-0 text-ink-faint" />
                  <span className="text-sm font-bold">{g.projectName}</span>
                  <a
                    href={g.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 truncate font-mono text-xs text-ink-soft hover:text-foreground"
                  >
                    {g.repoFullName}
                    <ExternalLink className="size-3" />
                  </a>
                </div>

                {g.error ? (
                  <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    <AlertCircle className="size-4 shrink-0" />
                    {g.error}
                  </div>
                ) : !g.hasFile ? (
                  <Empty>
                    No <span className="font-mono">cron.json</span> yet — ask the
                    agent to schedule something.
                  </Empty>
                ) : g.jobs.length === 0 ? (
                  <Empty>
                    <span className="font-mono">cron.json</span> has no jobs.
                  </Empty>
                ) : (
                  <div className="flex flex-col gap-2">
                    {g.jobs.map((j) => (
                      <div
                        key={j.name}
                        className={cn(
                          "rounded-lg border border-border bg-card px-4 py-3",
                          !j.enabled && "opacity-60",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <Clock
                            className={cn(
                              "size-4 shrink-0",
                              j.enabled ? "text-primary" : "text-ink-faint",
                            )}
                          />
                          <span className="truncate text-sm font-bold">
                            {j.name}
                          </span>
                          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-ink-soft">
                            {j.schedule}
                          </code>
                          {!j.enabled && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-ink-faint">
                              Disabled
                            </span>
                          )}
                          {j.lastChatId && (
                            <Link
                              href={`/chat/${j.lastChatId}`}
                              className="ml-auto shrink-0 text-xs font-semibold text-primary hover:underline"
                            >
                              View last run
                            </Link>
                          )}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 pl-6 text-xs text-ink-faint">
                          <span>
                            Next:{" "}
                            {j.nextRunAt ? (
                              <span className="text-ink-soft">
                                {fmtUtc(j.nextRunAt)} ({rel(j.nextRunAt)})
                              </span>
                            ) : j.enabled ? (
                              "—"
                            ) : (
                              "paused"
                            )}
                          </span>
                          <span>
                            Last run:{" "}
                            {j.lastRunAt ? (
                              <span className="text-ink-soft">
                                {rel(j.lastRunAt)}
                              </span>
                            ) : (
                              "never"
                            )}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Empty({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-ink-faint",
        className,
      )}
    >
      {children}
    </div>
  );
}
