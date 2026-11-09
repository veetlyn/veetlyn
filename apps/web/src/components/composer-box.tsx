"use client";

import { projectStatusLabel } from "@jendal-workspace/core";
import type { ContextNode } from "@jendal-workspace/core/context/node";
import { Button } from "@jendal-workspace/ui/components/button";
import { cn } from "@jendal-workspace/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { AgentIcon } from "@/components/agent-icon";
import { applySuggestion, composerTrigger, matchesQuery, mentionText } from "@/lib/composer-grammar";
import { trpc } from "@/utils/trpc";

const MAX_SUGGESTIONS = 8;
const LIST_HEIGHT = 256;
const TOP_BAR_HEIGHT = 72;

// The assistant's composer: the text on top, then one toolbar row with the scope it works on and the send key, both
// 28px tall on the same line and the same inset from the box's edges. Enter sends; Shift+Enter breaks the line.
// Given a node, @ suggests the projects this person can open and / the actions they can start there.
export default function ComposerBox({
  id,
  label,
  value,
  onChange,
  onSubmit,
  placeholder,
  scope,
  node,
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
  node?: ContextNode;
  busy: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  rows?: number;
  className?: string;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const nextCaret = useRef<number | null>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const trigger = node ? composerTrigger(value, caret) : null;
  const words = useQuery({
    ...trpc.agent.composer.queryOptions({ node: node ?? { kind: "account" } }),
    enabled: Boolean(node && trigger),
    staleTime: 60_000,
    retry: false,
    meta: { silent: true },
  });
  const options = !trigger || trigger.start === dismissedAt
    ? []
    : (trigger.kind === "@"
        ? (words.data?.records ?? []).map((record, _, records) => ({
            id: record.id,
            label: record.title,
            detail: [record.clientName, projectStatusLabel(record.status)].filter(Boolean).join(" · "),
            insert: mentionText(record, records),
          }))
        : (words.data?.actions ?? []).map((action) => ({ id: action.label, label: action.label, detail: null, insert: action.phrase }))
      ).filter((option) => matchesQuery(option.label, trigger.query)).slice(0, MAX_SUGGESTIONS);
  const open = options.length > 0;
  const highlighted = open ? Math.min(active, options.length - 1) : 0;
  const listId = `${id}-suggestions`;
  const box = useRef<HTMLDivElement>(null);
  const [opensBelow, setOpensBelow] = useState(false);

  // A composer high on the page has no room above it for the list.
  useLayoutEffect(() => {
    if (open && box.current) setOpensBelow(box.current.getBoundingClientRect().top < LIST_HEIGHT + TOP_BAR_HEIGHT);
  }, [open]);

  useLayoutEffect(() => {
    if (nextCaret.current === null) return;
    area.current?.setSelectionRange(nextCaret.current, nextCaret.current);
    setCaret(nextCaret.current);
    nextCaret.current = null;
  }, [value]);

  function choose(insert: string) {
    if (!trigger) return;
    const next = applySuggestion(value, caret, trigger, insert);
    nextCaret.current = next.caret;
    setDismissedAt(trigger.start);
    setActive(0);
    onChange(next.value);
  }

  return (
    <div ref={box} className={cn("relative rounded-[16px] bg-card raised focus-within:ring-3 focus-within:ring-ring/25", className)}>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={trigger?.kind === "@" ? "Projects" : "Actions"}
          className={cn(
            "absolute inset-x-0 z-20 max-h-64 overflow-y-auto rounded-[8px] border bg-popover p-1 text-sm text-popover-foreground",
            opensBelow ? "top-full mt-1.5" : "bottom-full mb-1.5",
          )}
        >
          {options.map((option, index) => (
            <li
              key={option.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === highlighted}
              onMouseEnter={() => setActive(index)}
              // Keeps the caret in the text while the row is pressed.
              onMouseDown={(event) => {
                event.preventDefault();
                choose(option.insert);
              }}
              className={cn(
                "flex cursor-pointer items-baseline justify-between gap-4 rounded-[6px] px-2.5 py-1.5",
                index === highlighted && "bg-accent",
              )}
            >
              <span className="truncate">{option.label}</span>
              {option.detail ? <span className="shrink-0 text-xs text-muted-foreground">{option.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <textarea
        ref={area}
        id={id}
        value={value}
        role={node ? "combobox" : undefined}
        aria-autocomplete={node ? "list" : undefined}
        aria-expanded={node ? open : undefined}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${highlighted}` : undefined}
        onChange={(event) => {
          setCaret(event.target.selectionStart);
          setDismissedAt(null);
          setActive(0);
          onChange(event.target.value);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={(event) => {
          if (open && !event.nativeEvent.isComposing) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : options.length - 1;
              setActive((highlighted + step) % options.length);
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              const option = options[highlighted];
              if (option) choose(option.insert);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setDismissedAt(trigger?.start ?? null);
              return;
            }
          }
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
        className="block w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-base outline-none! placeholder:text-muted-foreground disabled:opacity-60 md:text-[16px]"
      />
      <div className="flex items-center gap-2 px-3 pb-3">
        <span className="flex h-7 min-w-0 items-center gap-1.5 rounded-[8px] bg-secondary px-2.5 text-xs text-muted-foreground">
          <AgentIcon className="size-3 shrink-0 text-brand" />
          <span className="truncate">{scope}</span>
        </span>
        {node ? <span className="hidden truncate text-xs text-muted-foreground sm:inline">@ for a project, / for an action</span> : null}
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
