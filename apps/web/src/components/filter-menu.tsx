"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@jendal-workspace/ui/components/dropdown-menu";
import { cn } from "@jendal-workspace/ui/lib/utils";
import { ChevronDown } from "lucide-react";

// A filter as one raised key split in two: what it filters, then the chosen value. A chosen value reads in the
// foreground so a filtered list is visible at a glance.
export function FilterMenu({
  label,
  value,
  options,
  onChange,
  allLabel,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  allLabel: string;
}) {
  const current = options.find((option) => option.value === value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${label}: ${current?.label ?? allLabel}`}
        className="raised group inline-flex h-8 shrink-0 items-stretch overflow-hidden rounded-[8px] text-[13px] font-medium outline-none select-none hover:brightness-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-popup-open:brightness-[0.97]"
      >
        <span className="flex items-center px-2.5 text-muted-foreground">{label}</span>
        <span aria-hidden="true" className="w-px bg-border" />
        <span className={cn("flex items-center gap-1 pr-2 pl-2.5", current ? "text-foreground" : "text-muted-foreground")}>
          {current?.label ?? allLabel}
          <ChevronDown aria-hidden="true" className="size-3.5 opacity-60 transition-transform duration-150 ease-out group-data-popup-open:rotate-180" />
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-auto min-w-44 p-1">
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(String(next))}>
          <DropdownMenuRadioItem value="all" className="py-1.5 text-[13px]">{allLabel}</DropdownMenuRadioItem>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} className="py-1.5 text-[13px]">
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
