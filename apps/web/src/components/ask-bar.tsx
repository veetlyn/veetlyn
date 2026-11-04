"use client";

import type { ContextNode } from "@jendal-workspace/core/context/node";
import { Button } from "@jendal-workspace/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { trpc } from "@/utils/trpc";

// Veetlyn at the foot of a page (calls design §12, "Veetlyn on every page"): a question asked here starts a call at
// this page's node and opens it.
export default function AskBar({ slug, node, placeholder }: { slug: string; node: ContextNode; placeholder: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const ask = useMutation(
    trpc.agent.ask.mutationOptions({
      onSuccess: ({ callId }) => {
        setMessage("");
        router.push(`/${slug}/calls?call=${callId}`);
      },
    }),
  );

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (text && !ask.isPending) ask.mutate({ node, message: text });
  }

  return (
    <form onSubmit={send} className="shrink-0 border-t bg-card px-3 py-2.5 md:px-6">
      <div className="mx-auto flex max-w-3xl items-center gap-2 rounded-[12px] bg-card py-1 pr-1 pl-3.5 raised focus-within:ring-3 focus-within:ring-ring/25">
        <VeetlynSpark className="size-4 shrink-0 text-brand" />
        <label htmlFor="ask-veetlyn" className="sr-only">
          Ask Veetlyn
        </label>
        <input
          id="ask-veetlyn"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={placeholder}
          maxLength={4000}
          autoComplete="off"
          className="h-9 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
        />
        <Button type="submit" variant="mint" size="icon-sm" disabled={ask.isPending || message.trim() === ""} aria-label="Send to Veetlyn">
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

function VeetlynSpark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path d="M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8 6.6 6.6Z" fill="currentColor" />
    </svg>
  );
}
