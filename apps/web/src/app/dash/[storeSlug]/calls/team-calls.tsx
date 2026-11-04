"use client";

import type { ContextNode } from "@jendal-workspace/core/context/node";
import { Badge } from "@jendal-workspace/ui/components/badge";
import { Button, buttonVariants } from "@jendal-workspace/ui/components/button";
import { Textarea } from "@jendal-workspace/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import { AgentIcon } from "@/components/agent-icon";
import Loader from "@/components/loader";
import { trpc } from "@/utils/trpc";

type Entry = inferRouterOutputs<AppRouter>["agent"]["thread"]["entries"][number];

const CARD_STATE = {
  pending: { label: "Waiting for you", tone: "brand" },
  done: { label: "Done", tone: "good" },
  declined: { label: "Not sent", tone: "neutral" },
  failed: { label: "Refused", tone: "fail" },
} as const;

function ProposalCard({ entry, onDecided }: { entry: Entry; onDecided: () => void }) {
  const confirm = useMutation(trpc.agent.confirm.mutationOptions({ onSettled: onDecided }));
  const decline = useMutation(trpc.agent.decline.mutationOptions({ onSettled: onDecided }));
  const state = CARD_STATE[entry.status ?? "pending"];
  const busy = confirm.isPending || decline.isPending;
  return (
    <div className="panel space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm font-medium whitespace-pre-wrap">{entry.body}</p>
        <Badge tone={state.tone}>{state.label}</Badge>
      </div>
      {entry.note ? <p className="text-sm text-muted-foreground">{entry.note}</p> : null}
      {entry.outcome && entry.status !== "done" ? (
        <p className="text-sm text-muted-foreground">{entry.outcome}</p>
      ) : null}
      {entry.status === "pending" ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => confirm.mutate({ entryId: entry.id })}>
            Confirm
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => decline.mutate({ entryId: entry.id })}>
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

// Calls with the assistant (calls design §5–6, §12). With a subject (a project, a seller) the call is a split: the
// conversation on the left, the thing it works on live on the right, as an editor beside its preview. Above the
// sellers the conversation stands alone. The assistant reads with the person's access and drafts actions as cards;
// nothing happens until they confirm.
export default function TeamCalls({
  listNode,
  askNode,
  callsPath,
  backHref,
  backLabel,
  projectHref,
  assistantName,
  callId,
  subject,
}: {
  // The node whose calls the list shows, and the one a new call opens at (a project's, when started from it).
  listNode: ContextNode;
  askNode: ContextNode;
  callsPath: string;
  // Where the pane's back link leads: the node's own page.
  backHref: string;
  backLabel: string;
  // A project's page, for "On the table"; null above the sellers.
  projectHref: ((projectId: string) => string) | null;
  assistantName: string;
  callId: string | null;
  // What the right pane shows for the call's project (or none): absent when the node has nothing to show beside it.
  subject?: (projectId: string | null) => React.ReactNode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  // A new call is shown as soon as the server names it: moving to ?call= reloads the server page, which can take a
  // few seconds, and the question would otherwise vanish into an empty composer meanwhile.
  const [startedCallId, setStartedCallId] = useState<string | null>(null);
  const activeCallId = callId ?? startedCallId;
  // Once the URL names the call it holds it, so a later "New call" (no ?call=) starts clean.
  useEffect(() => {
    if (callId) setStartedCallId(null);
  }, [callId]);
  const node = askNode;
  const projectId = askNode.kind === "record" ? askNode.record.id : null;
  const calls = useQuery({
    ...trpc.agent.calls.queryOptions({ node: listNode }),
    retry: false,
    meta: { silent: true },
  });
  const thread = useQuery({
    ...trpc.agent.thread.queryOptions({ callId: activeCallId ?? "" }),
    enabled: activeCallId !== null,
    retry: false,
    meta: { silent: true },
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: trpc.agent.calls.queryKey({ node: listNode }) });
    if (activeCallId)
      void queryClient.invalidateQueries({ queryKey: trpc.agent.thread.queryKey({ callId: activeCallId }) });
  };
  const ask = useMutation(
    trpc.agent.ask.mutationOptions({
      onSuccess: (result) => {
        setMessage("");
        if (result.callId !== activeCallId) {
          setStartedCallId(result.callId);
          void queryClient.invalidateQueries({ queryKey: trpc.agent.thread.queryKey({ callId: result.callId }) });
          router.push(`${callsPath}?call=${result.callId}`);
        }
      },
      onSettled: refresh,
    }),
  );

  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || ask.isPending) return;
    ask.mutate(activeCallId ? { node, message: text, callId: activeCallId } : { node, message: text });
  }

  if (calls.isPending) return <Loader />;
  const available = calls.data?.available ?? false;
  const current = thread.data?.call ?? null;
  const onTable = current?.projectId ?? (activeCallId ? null : projectId);
  const others = (calls.data?.calls ?? []).filter((c) => c.id !== activeCallId).slice(0, 8);

  const conversation = (
    <section aria-label="Call" className="flex h-full min-h-0 min-w-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
        <Link
          href={backHref}
          className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{backLabel}</span>
        </Link>
        <span className="ml-auto truncate text-sm font-medium">{current?.title ?? ""}</span>
        {activeCallId ? (
          <Link href={callsPath} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            New call
          </Link>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5">
        {!available ? (
          <p className="panel p-4 text-sm text-muted-foreground">The assistant is not set up on this server yet.</p>
        ) : null}
        {projectHref && onTable && !subject ? (
          <p className="text-sm text-muted-foreground">
            On the table:{" "}
            <Link href={projectHref(onTable)} className="underline underline-offset-4">
              this project
            </Link>
          </p>
        ) : null}
        {activeCallId && thread.isPending ? <Loader /> : null}
        {thread.isError ? <p className="text-sm text-muted-foreground">This call is not available.</p> : null}
        {!activeCallId ? (
          <div className="space-y-4 pt-6">
            <div className="space-y-1.5">
              <h1 className="font-heading text-2xl">What needs doing?</h1>
              <p className="text-sm text-muted-foreground">
                {assistantName} reads what you can see here, answers, and drafts payout decisions, quotes and messages
                for you to confirm. Nothing is sent until you confirm it.
              </p>
            </div>
            {others.length > 0 ? (
              <div>
                <p className="pb-1 text-xs font-medium text-muted-foreground">Your calls</p>
                <ul className="grid gap-0.5">
                  {others.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`${callsPath}?call=${c.id}`}
                        className="block truncate rounded-[9px] px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
                      >
                        {c.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        <ol className="space-y-4">
          {thread.data?.entries.map((entry) =>
            entry.kind === "proposal" ? (
              <li key={entry.id}>
                <ProposalCard entry={entry} onDecided={refresh} />
              </li>
            ) : entry.author === "person" ? (
              <li
                key={entry.id}
                className="ml-auto max-w-[85%] rounded-[14px_14px_4px_14px] bg-secondary px-3.5 py-2.5 text-sm whitespace-pre-wrap"
              >
                {entry.body}
              </li>
            ) : (
              <li key={entry.id} className="space-y-1">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <AgentIcon className="size-3.5 text-brand" />
                  {assistantName}
                </p>
                <p className="text-sm whitespace-pre-wrap">{entry.body}</p>
              </li>
            ),
          )}
          {ask.isPending ? <li className="text-sm text-muted-foreground">{assistantName} is looking…</li> : null}
        </ol>
      </div>
      <form onSubmit={send} className="shrink-0 px-3 pt-1 pb-3">
        <label htmlFor="call-message" className="sr-only">
          Message
        </label>
        <div className="relative">
          <Textarea
            id="call-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) event.currentTarget.form?.requestSubmit();
            }}
            placeholder={activeCallId ? `Reply to ${assistantName}` : `Ask ${assistantName}`}
            aria-keyshortcuts="Control+Enter Meta+Enter"
            maxLength={4000}
            disabled={!available}
            className="min-h-24 rounded-[14px] pr-14 pb-3"
          />
          <Button
            type="submit"
            variant="mint"
            size="icon-sm"
            aria-label="Send"
            className="absolute right-2.5 bottom-2.5"
            disabled={!available || ask.isPending || message.trim() === ""}
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
    </section>
  );

  if (!subject) {
    return <div className="mx-auto min-h-0 w-full max-w-3xl flex-1">{conversation}</div>;
  }
  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] lg:grid-cols-[minmax(360px,440px)_minmax(0,1fr)]">
      <div className="min-h-0 lg:border-r">{conversation}</div>
      <div aria-label="What this call works on" className="hidden min-h-0 overflow-y-auto bg-background lg:block">
        {subject(onTable)}
      </div>
    </div>
  );
}
