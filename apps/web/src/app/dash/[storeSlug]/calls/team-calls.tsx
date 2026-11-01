"use client";

import { Badge } from "@jendal-workspace/ui/components/badge";
import { Button } from "@jendal-workspace/ui/components/button";
import { Textarea } from "@jendal-workspace/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import Loader from "@/components/loader";
import { trpc } from "@/utils/trpc";

type Entry = inferRouterOutputs<AppRouter>["agent"]["thread"]["entries"][number];

const CARD_STATE = {
  pending: { label: "Waiting for you", tone: "brand" },
  done: { label: "Done", tone: "good" },
  declined: { label: "Not sent", tone: "neutral" },
  failed: { label: "Refused", tone: "fail" },
} as const;

function ProposalCard({ entry, teamSlug, onDecided }: { entry: Entry; teamSlug: string; onDecided: () => void }) {
  const confirm = useMutation(trpc.agent.confirm.mutationOptions({ onSettled: onDecided }));
  const decline = useMutation(trpc.agent.decline.mutationOptions({ onSettled: onDecided }));
  const state = CARD_STATE[entry.status ?? "pending"];
  const busy = confirm.isPending || decline.isPending;
  return (
    <div className="panel space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm font-medium">{entry.body}</p>
        <Badge tone={state.tone}>{state.label}</Badge>
      </div>
      {entry.outcome && entry.status !== "done" ? <p className="text-sm text-muted-foreground">{entry.outcome}</p> : null}
      {entry.status === "pending" ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => confirm.mutate({ teamSlug, entryId: entry.id })}>
            Confirm
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => decline.mutate({ teamSlug, entryId: entry.id })}>
            Not now
          </Button>
        </div>
      ) : null}
      {confirm.error || decline.error ? (
        <p role="alert" className="text-sm text-destructive">
          {(confirm.error ?? decline.error)?.message}
        </p>
      ) : null}
    </div>
  );
}

// Calls with the assistant (calls design §5–6): the person's own calls on the left, the thread in the middle. The
// assistant reads with the person's access and drafts actions as cards; nothing happens until they confirm.
export default function TeamCalls({
  teamSlug,
  assistantName,
  callId,
  projectId,
}: {
  teamSlug: string;
  assistantName: string;
  callId: string | null;
  projectId: string | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const calls = useQuery({ ...trpc.agent.calls.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const thread = useQuery({
    ...trpc.agent.thread.queryOptions({ teamSlug, callId: callId ?? "" }),
    enabled: callId !== null,
    retry: false,
    meta: { silent: true },
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.agent.calls.queryKey({ teamSlug }) });
    if (callId) void queryClient.invalidateQueries({ queryKey: trpc.agent.thread.queryKey({ teamSlug, callId }) });
  };
  const ask = useMutation(
    trpc.agent.ask.mutationOptions({
      onSuccess: (result) => {
        setMessage("");
        if (result.callId !== callId) router.push(`/${teamSlug}/calls?call=${result.callId}`);
      },
      onSettled: refresh,
    }),
  );

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || ask.isPending) return;
    ask.mutate({ teamSlug, message: text, ...(callId ? { callId } : projectId ? { projectId } : {}) });
  }

  if (calls.isPending) return <Loader />;
  const available = calls.data?.available ?? false;
  const current = thread.data?.call ?? null;
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 md:px-7 md:py-8 lg:grid-cols-[260px_minmax(0,1fr)]">
      <nav aria-label="Calls" className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="font-heading text-2xl">Calls</h1>
          <Link href={`/${teamSlug}/calls`} className="text-sm underline underline-offset-4">
            New call
          </Link>
        </div>
        {calls.data && calls.data.calls.length > 0 ? (
          <ul className="grid gap-0.5">
            {calls.data.calls.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/${teamSlug}/calls?call=${c.id}`}
                  aria-current={c.id === callId ? "page" : undefined}
                  className="block truncate rounded-lg px-2.5 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:text-foreground"
                >
                  {c.title}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Your calls show here. Only you see them.</p>
        )}
      </nav>
      <section aria-label="Call" className="flex min-w-0 flex-col gap-4">
        {!available ? (
          <p className="panel p-4 text-sm text-muted-foreground">The assistant is not set up on this server yet.</p>
        ) : null}
        {current?.projectId || (!callId && projectId) ? (
          <p className="text-sm text-muted-foreground">
            On the table:{" "}
            <Link href={`/${teamSlug}/projects/${current?.projectId ?? projectId}`} className="underline underline-offset-4">
              this project
            </Link>
          </p>
        ) : null}
        {callId && thread.isPending ? <Loader /> : null}
        {thread.isError ? <p className="text-sm text-muted-foreground">This call is not available.</p> : null}
        {!callId ? (
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Ask {assistantName}</h2>
            <p className="text-sm text-muted-foreground">
              It reads what you can see in this team, answers, and drafts payout decisions, quotes and messages for you to
              confirm. Nothing is sent until you confirm it.
            </p>
          </div>
        ) : null}
        <ol className="space-y-3">
          {thread.data?.entries.map((entry) =>
            entry.kind === "proposal" ? (
              <li key={entry.id}>
                <ProposalCard entry={entry} teamSlug={teamSlug} onDecided={refresh} />
              </li>
            ) : (
              <li key={entry.id} className={entry.author === "person" ? "ml-auto max-w-[85%]" : "max-w-[85%]"}>
                <p className="mb-1 text-xs text-muted-foreground">{entry.author === "person" ? "You" : assistantName}</p>
                <p className={entry.author === "person" ? "panel p-3 text-sm whitespace-pre-wrap" : "text-sm whitespace-pre-wrap"}>
                  {entry.body}
                </p>
              </li>
            ),
          )}
          {ask.isPending ? <li className="text-sm text-muted-foreground">{assistantName} is looking…</li> : null}
        </ol>
        <form onSubmit={send} className="space-y-2">
          <label htmlFor="call-message" className="sr-only">
            Message
          </label>
          <Textarea
            id="call-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit();
            }}
            placeholder={callId ? "Reply" : "What do you need? For example: which payouts wait for me?"}
            maxLength={4000}
            disabled={!available}
          />
          <div className="flex items-center justify-between gap-3">
            {ask.error ? (
              <p role="alert" className="text-sm text-destructive">
                {ask.error.message}
              </p>
            ) : (
              <span className="text-xs text-muted-foreground">Ctrl or ⌘ + Enter sends</span>
            )}
            <Button type="submit" disabled={!available || ask.isPending || message.trim() === ""}>
              Send
            </Button>
          </div>
        </form>
      </section>
    </main>
  );
}
