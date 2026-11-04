"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { cn } from "@jendal-workspace/ui/lib/utils";
import { ArrowUp } from "lucide-react";

import { AgentIcon } from "@/components/agent-icon";

// The assistant's composer: the text on top, then one toolbar row with the scope it works on and the send key, both
// 28px tall on the same line and the same inset from the box's edges. Enter sends; Shift+Enter breaks the line.
export default function ComposerBox({
  id,
  label,
  value,
  onChange,
  onSubmit,
  placeholder,
  scope,
  busy,
  disabled,
  autoFocus,
  rows = 2,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  scope: string;
  busy: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("rounded-[16px] bg-card raised focus-within:ring-3 focus-within:ring-ring/25", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            onSubmit();
          }
        }}
        placeholder={placeholder}
        maxLength={4000}
        rows={rows}
        disabled={disabled}
        autoFocus={autoFocus}
        className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-base outline-none placeholder:text-muted-foreground disabled:opacity-60 md:text-[16px]"
      />
      <div className="flex items-center gap-2 px-3 pb-3">
        <span className="flex h-7 min-w-0 items-center gap-1.5 rounded-[8px] bg-secondary px-2.5 text-xs text-muted-foreground">
          <AgentIcon className="size-3 shrink-0 text-brand" />
          <span className="truncate">{scope}</span>
        </span>
        <Button
          type="button"
          variant="mint"
          size="icon-xs"
          className="ml-auto size-7"
          onClick={onSubmit}
          disabled={busy || disabled || value.trim() === ""}
          aria-label="Send"
        >
          <ArrowUp aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
