"use client";

import { projectStatusLabel } from "@jendal-workspace/core";
import type { ContextNode } from "@jendal-workspace/core/context/node";
import { PromptInput } from "@jendal-workspace/ui/components/agents/prompt-input";
import { cn } from "@jendal-workspace/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";

import { AgentIcon } from "@/components/agent-icon";
import { applySuggestion, composerTrigger, matchesQuery, mentionText } from "@/lib/composer-grammar";
import { trpc } from "@/utils/trpc";

const MAX_SUGGESTIONS = 8;
const LIST_HEIGHT = 256;
const TOP_BAR_HEIGHT = 72;

// The assistant's composer, composed on beUI's PromptInput (packages/ui/src/components/agents): the text on top, then
// one toolbar row with the scope it works on and the send key. Enter sends; Shift+Enter breaks the line. Given a node,
// @ suggests the projects this person can open and / the actions they can start there. PromptInput keeps its textarea
// ref, so the caret is read and restored through the textarea's id.
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
  const area = () => {
    const element = document.getElementById(id);
    return element instanceof HTMLTextAreaElement ? element : null;
  };
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
    area()?.setSelectionRange(nextCaret.current, nextCaret.current);
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
    <div ref={box} data-composer className={cn("relative", className)}>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={trigger?.kind === "@" ? "Projects" : "Actions"}
          className={cn(
            "absolute inset-x-0 z-20 max-h-64 overflow-y-auto rounded-xl border bg-popover p-1 text-sm text-popover-foreground",
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
                "flex cursor-pointer items-baseline justify-between gap-4 rounded-lg px-2.5 py-1.5",
                index === highlighted && "bg-accent",
              )}
            >
              <span className="truncate">{option.label}</span>
              {option.detail ? <span className="shrink-0 text-xs text-muted-foreground">{option.detail}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <PromptInput
        id={id}
        aria-label={label}
        value={value}
        onValueChange={(next) => {
          setCaret(area()?.selectionStart ?? next.length);
          setDismissedAt(null);
          setActive(0);
          onChange(next);
        }}
        // Sending while a reply is on its way is refused here rather than shown as a stop key with nothing to stop.
        onSubmit={() => {
          if (!busy) onSubmit();
        }}
        role={node ? "combobox" : undefined}
        aria-autocomplete={node ? "list" : undefined}
        aria-expanded={node ? open : undefined}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${highlighted}` : undefined}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={(event) => {
          // A preventDefault here stops PromptInput's own Enter-to-send while a suggestion list is open.
          if (!open || event.nativeEvent.isComposing) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : options.length - 1;
            setActive((highlighted + step) % options.length);
          } else if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            const option = options[highlighted];
            if (option) choose(option.insert);
          } else if (event.key === "Escape") {
            event.preventDefault();
            setDismissedAt(trigger?.start ?? null);
          }
        }}
        placeholder={placeholder}
        maxLength={4000}
        minRows={rows}
        disabled={disabled}
        autoFocus={autoFocus}
        className="bg-card"
        leadingAction={
          <span className="flex min-w-0 items-center gap-2 pl-1">
            <span className="flex h-7 min-w-0 items-center gap-1.5 rounded-lg bg-secondary px-2.5 text-xs text-muted-foreground">
              <AgentIcon className="size-3 shrink-0 text-brand" />
              <span className="truncate">{scope}</span>
            </span>
            {node ? <span className="hidden truncate text-xs text-muted-foreground sm:inline">@ for a project, / for an action</span> : null}
          </span>
        }
      />
    </div>
  );
}
