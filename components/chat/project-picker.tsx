"use client";

import { useState } from "react";
import { ChevronDown, Check, FolderGit2 } from "lucide-react";
import type { ProjectSummary } from "@/lib/projects";
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

// Compact chat-composer picker for the project a chat runs in. Mirrors the
// model-picker (Popover + Command) pattern. Every chat has a project.
export function ProjectPicker({
  value,
  onChange,
  projects,
  disabled = false,
}: {
  value: string;
  onChange: (id: string) => void;
  projects: ProjectSummary[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const current = projects.find((p) => p.id === value);
  const label = current?.name ?? "Select project";

  function pick(id: string) {
    onChange(id);
    setOpen(false);
    setSearch("");
  }

  // On an existing chat the picker is locked to its project; surface it as a
  // link out to the repo on GitHub (main) instead of an inert label.
  if (disabled) {
    return (
      <a
        href={current?.htmlUrl ?? "#"}
        target="_blank"
        rel="noreferrer"
        title="View repository on GitHub"
        className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft outline-none transition-colors hover:text-foreground"
      >
        <FolderGit2 className="size-3.5" />
        {label}
      </a>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex items-center gap-1.5 text-sm font-semibold text-ink-soft outline-none transition-colors hover:text-foreground">
        <FolderGit2 className="size-3.5" />
        {label}
        <ChevronDown className="size-3.5" strokeWidth={2.2} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-75 p-0">
        <Command shouldFilter>
          <CommandInput
            placeholder="Search projects…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No projects found.</CommandEmpty>
            <CommandGroup>
              {projects.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.name} ${p.repoFullName}`}
                  onSelect={() => pick(p.id)}
                >
                  <FolderGit2 className="size-3.5 shrink-0 text-ink-faint" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {p.name}
                  </span>
                  {value === p.id && (
                    <Check className="size-3.5 shrink-0 text-primary" />
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
