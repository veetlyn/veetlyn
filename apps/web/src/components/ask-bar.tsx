"use client";

import type { ContextNode } from "@jendal-workspace/core/context/node";
import { Button } from "@jendal-workspace/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { usePlatformName } from "@/components/platform-name";
import { trpc } from "@/utils/trpc";

// The assistant at the foot of a page (calls design §12, "the assistant on every page"): a question asked here starts a call at
// this page's node and opens it.
// The hero form sits in the middle of a home page: a large box with the scope it works on named under the text.
export default function AskBar({
  callsPath,
  node,
  placeholder,
  hero,
}: {
  callsPath: string;
  node: ContextNode;
  placeholder: string;
  hero?: { scope: string };
}) {
  const router = useRouter();
  const platform = usePlatformName();
  const [message, setMessage] = useState("");
  const ask = useMutation(
    trpc.agent.ask.mutationOptions({
      onSuccess: ({ callId }) => {
        setMessage("");
        router.push(`${callsPath}?call=${callId}`);
      },
    }),
  );

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (text && !ask.isPending) ask.mutate({ node, message: text });
  }

  if (hero) {
    return (
      <form onSubmit={send} className="w-full">
        <label htmlFor="ask-agent-hero" className="sr-only">
          Ask {platform}
        </label>
        <div className="relative rounded-[18px] bg-card raised focus-within:ring-3 focus-within:ring-ring/25">
          <textarea
            id="ask-agent-hero"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={placeholder}
            maxLength={4000}
            rows={2}
            className="block w-full resize-none bg-transparent px-5 pt-4 pb-14 text-base outline-none placeholder:text-muted-foreground"
          />
          <span className="pointer-events-none absolute bottom-3.5 left-4 flex items-center gap-1.5 rounded-[7px] bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
            <AgentSpark className="size-3 text-brand" />
            {hero.scope}
          </span>
          <Button
            type="submit"
            variant="mint"
            size="icon-sm"
            className="absolute right-3 bottom-3"
            disabled={ask.isPending || message.trim() === ""}
            aria-label={`Send to ${platform}`}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
        </div>
        {ask.error ? (
          <p role="alert" className="mt-1.5 text-sm text-destructive">
            {ask.error.message}
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <form onSubmit={send} className="shrink-0 px-3 pt-1 pb-3 md:px-6">
      <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-[12px] bg-card py-1 pr-1 pl-3.5 raised focus-within:ring-3 focus-within:ring-ring/25">
        <AgentSpark className="size-4 shrink-0 text-brand" />
        <label htmlFor="ask-agent" className="sr-only">
          Ask {platform}
        </label>
        <input
          id="ask-agent"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={placeholder}
          maxLength={4000}
          autoComplete="off"
          className="h-9 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
        />
        <Button
          type="submit"
          variant="mint"
          size="icon-sm"
          disabled={ask.isPending || message.trim() === ""}
          aria-label={`Send to ${platform}`}
        >
          <ArrowUp aria-hidden="true" />
        </Button>
      </div>
      {ask.error ? (
        <p role="alert" className="mx-auto mt-1.5 max-w-3xl text-sm text-destructive">
          {ask.error.message}
        </p>
      ) : null}
    </form>
  );
}

function AgentSpark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path d="M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8 6.6 6.6Z" fill="currentColor" />
    </svg>
  );
}
