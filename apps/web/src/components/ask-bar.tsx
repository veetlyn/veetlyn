"use client";

import type { ContextNode } from "@jendal-workspace/core/context/node";
import { Button } from "@jendal-workspace/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import ComposerBox from "@/components/composer-box";
import { usePlatformName } from "@/components/platform-name";
import { trpc } from "@/utils/trpc";

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
  hero: { scope: string; suggestions?: { label: string; message: string }[] };
}) {
  const router = useRouter();
  const platform = usePlatformName();
  const [message, setMessage] = useState("");
  const ask = useMutation(
    trpc.agent.ask.mutationOptions({
      onSuccess: ({ callId }) => {
        setMessage("");
        router.push(`${callsPath}?thread=${callId}`);
      },
    }),
  );

  function submit() {
    const text = message.trim();
    if (text && !ask.isPending) ask.mutate({ node, message: text });
  }

  return (
    <div className="w-full text-left">
      <ComposerBox
        id="ask-agent-hero"
        label={`Ask ${platform}`}
        value={message}
        onChange={setMessage}
        onSubmit={submit}
        placeholder={placeholder}
        scope={hero.scope}
        node={node}
        busy={ask.isPending}
        className="rounded-[10px]"
      />
      {hero.suggestions ? (
        <div className="mt-3 flex flex-wrap justify-center gap-2" aria-label="Suggested questions">
          {hero.suggestions.map((suggestion) => (
            <Button
              key={suggestion.label}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setMessage(suggestion.message);
                document.getElementById("ask-agent-hero")?.focus();
              }}
              disabled={ask.isPending}
            >
              {suggestion.label}
            </Button>
          ))}
        </div>
      ) : null}
      {ask.error ? (
        <p role="alert" className="mt-1.5 text-sm text-destructive">
          {ask.error.message}
        </p>
      ) : null}
    </div>
  );
}
