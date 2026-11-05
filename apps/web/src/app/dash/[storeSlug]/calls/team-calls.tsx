"use client";

import type { ContextNode } from "@jendal-workspace/core/context/node";
import { Badge } from "@jendal-workspace/ui/components/badge";
import { Button, buttonVariants } from "@jendal-workspace/ui/components/button";
import { cn } from "@jendal-workspace/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import { AgentIcon } from "@/components/agent-icon";
import ComposerBox from "@/components/composer-box";
import Loader from "@/components/loader";
import { authClient } from "@/lib/auth-client";
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

// Calls with the assistant (calls design §5–6): a conversation at one node of the tree, shaped like a chat. An empty
// call greets the person with the composer under it; a running one keeps the composer at the foot. The assistant
// reads with the person's access and drafts actions as cards; nothing happens until they confirm.
export default function TeamCalls({
  listNode,
  askNode,
  callsPath,
  scopeName,
  teamSlug,
  projectHref,
  assistantName,
  callId,
}: {
  // The node whose calls the list shows, and the one a new call opens at (a project's, when started from it).
  listNode: ContextNode;
  askNode: ContextNode;
  callsPath: string;
  // What the call works on, named on the composer's chip.
  scopeName: string;
  teamSlug?: string;
  // A project's page, for "On the table"; null above the sellers.
  projectHref: ((projectId: string) => string) | null;
  assistantName: string;
  callId: string | null;
}) {
  const router = useRouter();
  const { data: session } = authClient.useSession();
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

  function send() {
    const text = message.trim();
    if (!text || ask.isPending) return;
    ask.mutate(activeCallId ? { node, message: text, callId: activeCallId } : { node, message: text });
  }

  if (calls.isPending) return <Loader />;
  const available = calls.data?.available ?? false;
  const current = thread.data?.call ?? null;
  const onTable = current?.projectId ?? (activeCallId ? null : projectId);
  const project = useQuery({
    ...trpc.project.get.queryOptions({ teamSlug: teamSlug ?? "", projectId: onTable ?? "" }),
    enabled: Boolean(teamSlug && onTable),
    retry: false,
    meta: { silent: true },
  });
  const firstName = session?.user.name.split(/\s+/)[0] ?? "";
  const scopeLabel = onTable ? project.data?.project.title ?? "Project" : scopeName;

  const composer = (
    <div className={activeCallId ? "shrink-0 px-3 pt-1 pb-3" : "w-full"}>
      <ComposerBox
        id="call-message"
        label="Message"
        value={message}
        onChange={setMessage}
        onSubmit={send}
        placeholder={activeCallId ? `Reply to ${assistantName}` : "What needs doing?"}
        scope={scopeLabel}
        busy={ask.isPending}
        disabled={!available}
        autoFocus={!activeCallId}
        rows={activeCallId ? 2 : 3}
      />
      {ask.error ? (
        <p role="alert" className="mt-1.5 text-sm text-destructive">
          {ask.error.message}
        </p>
      ) : null}
    </div>
  );

  const conversation = (
    <section aria-label="Chat" className="flex h-full min-h-0 min-w-0 flex-col">
      {activeCallId ? (
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
          <span className="truncate text-sm font-medium">{current?.title ?? ""}</span>
          <Link href={callsPath} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "ml-auto")}>
            New chat
          </Link>
        </div>
      ) : null}
      <div className={cn("min-h-0 flex-1 space-y-4 overflow-y-auto px-4", activeCallId ? "py-5" : "py-0")}>
        {!available ? (
          <p className="panel p-4 text-sm text-muted-foreground">The assistant is not set up on this server yet.</p>
        ) : null}
        {projectHref && onTable ? (
          <p className="text-sm text-muted-foreground">
            On the table:{" "}
            <Link href={projectHref(onTable)} className="underline underline-offset-4">
              {project.data?.project.title ?? "this project"}
            </Link>
          </p>
        ) : null}
        {activeCallId && thread.isPending ? <Loader /> : null}
        {thread.isError ? <p className="text-sm text-muted-foreground">This chat isn’t available.</p> : null}
        {!activeCallId ? (
          <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 py-8">
            <h1 className="flex items-center justify-center gap-3 text-center font-heading text-[29px] leading-tight tracking-[-0.02em]">
              <AgentIcon className="size-7 shrink-0" />
              {firstName ? `Hello, ${firstName}` : "Hello"}
            </h1>
            {composer}
            <p className="text-center text-[14px] text-muted-foreground">
              {assistantName} reads what you can see and drafts quotes, messages and payout decisions. Nothing is sent
              until you confirm it.
            </p>
          </div>
        ) : null}
        {activeCallId ? (
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
                    <AgentIcon className="size-3.5" />
                    {assistantName}
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{entry.body}</p>
                </li>
              ),
            )}
            {ask.isPending ? <li className="text-sm text-muted-foreground">{assistantName} is looking…</li> : null}
          </ol>
        ) : null}
      </div>
      {activeCallId ? composer : null}
    </section>
  );

  return <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">{conversation}</div>;
}
