"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronsUpDown, Check } from "lucide-react";
import { type ModelOption } from "@/lib/models";
import { providerOf, providerLabel, providerAccent } from "@/lib/providers";
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

export function ModelPicker({
  model,
  onModelChange,
  models = [],
  variant = "inline",
}: {
  model: string;
  onModelChange: (m: string) => void;
  models?: ModelOption[];
  variant?: "inline" | "field";
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const groups = useMemo(() => {
    const by = new Map<string, ModelOption[]>();
    for (const m of models) {
      const p = providerOf(m.id);
      const arr = by.get(p) ?? [];
      arr.push(m);
      by.set(p, arr);
    }
    return [...by.entries()];
  }, [models]);

  const currentLabel = models.find((m) => m.id === model)?.label ?? model;

  function pick(id: string) {
    onModelChange(id);
    setOpen(false);
    setSearch("");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {variant === "field" ? (
        <PopoverTrigger className="flex w-full items-center gap-3 rounded-xl border border-input bg-card px-4 py-3 text-left outline-none transition-colors hover:bg-accent">
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: providerAccent(model) }}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-bold">
              {currentLabel}
            </span>
            {model.includes("/") && (
              <span className="block truncate font-mono text-[11.5px] text-ink-soft">
                {model}
              </span>
            )}
          </span>
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-input bg-muted text-ink-soft">
            <ChevronsUpDown className="size-4" />
          </span>
        </PopoverTrigger>
      ) : (
        <PopoverTrigger className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-soft outline-none transition-colors hover:text-foreground">
          {currentLabel}
          <ChevronDown className="size-3.5" strokeWidth={2.2} />
        </PopoverTrigger>
      )}
      <PopoverContent
        align={variant === "field" ? "start" : "end"}
        className={variant === "field" ? "w-[420px] p-0" : "w-[300px] p-0"}
      >
        <Command shouldFilter>
          <CommandInput
            placeholder="Search models…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No models found.</CommandEmpty>
            {groups.map(([provider, items]) => (
              <CommandGroup key={provider} heading={providerLabel(provider)}>
                {items.map((m) => (
                  <CommandItem
                    key={m.id}
                    value={`${m.label} ${m.id}`}
                    onSelect={() => pick(m.id)}
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: providerAccent(m.id) }}
                    />
                    <span className="min-w-0 flex-1 truncate text-[13.5px]">
                      {m.label}
                    </span>
                    {model === m.id && (
                      <Check className="size-[14px] shrink-0 text-primary" />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
