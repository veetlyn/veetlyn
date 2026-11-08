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
import AgentText from "@/components/agent-text";
import ComposerBox from "@/components/composer-box";
import Loader from "@/components/loader";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

type Entry = inferRouterOutputs<AppRouter>["agent"]["thread"]["entries"][number];

const CARD_STATE = {
  pending: { label: "Needs you", tone: "brand" },
  done: { label: "Done", tone: "good" },
  declined: { label: "Not sent", tone: "neutral" },
  failed: { label: "Refused", tone: "fail" },
} as const;

type Card = NonNullable<Entry["card"]>;

const CARD_TITLE = (card: Card) =>
  card.kind === "quote"
    ? `Quote for ${card.project}`
    : card.kind === "message"
      ? `Message on ${card.project}`
      : `${card.decision === "approve" ? "Approve" : "Reject"} payout to ${card.member}`;

// The facts come from the server's reading of what will run; the assistant's own words are only the note under them.
function CardFacts({ card }: { card: Card }) {
  if (card.kind === "quote")
    return (
      <div className="frame frame-body text-[14px]">
        <ul>
          {card.lines.map((line) => (
            <li key={line.label} className="flex justify-between gap-4 border-b px-3.5 py-2.5">
              <span className="min-w-0">{line.label}</span>
              <span className="font-tabular whitespace-nowrap">{line.amount}</span>
            </li>
          ))}
        </ul>
        <div className="flex items-baseline justify-between gap-4 px-3.5 py-2.5 font-medium">
          <span>Total, delivered in {card.delivery}</span>
          <span className="font-tabular text-[16px] whitespace-nowrap">{card.total}</span>
        </div>
      </div>
    );
  if (card.kind === "payout")
    return (
      <div className="frame frame-body flex items-baseline justify-between gap-4 px-3.5 py-3 text-[14px]">
        <span>{card.member}</span>
        <span className="font-tabular text-[16px] font-medium">{card.amount}</span>
      </div>
    );
  return (
    <div className="frame frame-body grid gap-1 px-3.5 py-3 text-[14px]">
      <span className="text-muted-foreground">To: {card.audience}</span>
      <p className="whitespace-pre-wrap">{card.body}</p>
    </div>
  );
}

function ProposalCard({ entry, onDecided }: { entry: Entry; onDecided: () => void }) {
  const confirm = useMutation(trpc.agent.confirm.mutationOptions({ onSettled: onDecided }));
  const decline = useMutation(trpc.agent.decline.mutationOptions({ onSettled: onDecided }));
  const state = CARD_STATE[entry.status ?? "pending"];
  const busy = confirm.isPending || decline.isPending;
  const card = entry.card;
  return (
    <div className="frame frame-panel" aria-label="Decision">
      <div className="frame-head flex items-center gap-3 text-[14px]">
        <h3 className="min-w-0 truncate font-medium">{card ? CARD_TITLE(card) : "Proposed action"}</h3>
        <Badge tone={state.tone} className="ml-auto shrink-0">
          {state.label}
        </Badge>
      </div>
      {card ? (
        <CardFacts card={card} />
      ) : (
        <p className="frame frame-body px-3.5 py-3 text-[14px] whitespace-pre-wrap">{entry.body}</p>
      )}
      <div className="grid gap-3 px-3.5 py-3">
        {entry.note ? (
          <p className="flex gap-2 text-[14px] text-muted-foreground">
            <AgentIcon className="mt-[3px] size-3.5 shrink-0" />
            <span>{entry.note}</span>
          </p>
        ) : null}
        {entry.outcome && entry.status !== "done" ? <p className="text-[14px] text-muted-foreground">{entry.outcome}</p> : null}
        {entry.status === "pending" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="mint" disabled={busy} onClick={() => confirm.mutate({ entryId: entry.id })}>
              {confirm.isPending ? "Working…" : (card?.cta ?? "Confirm")}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => decline.mutate({ entryId: entry.id })}>
              Not now
            </Button>
            <span className="text-[13px] text-muted-foreground">Nothing happens until you press this.</span>
          </div>
        ) : null}
        {confirm.error || decline.error ? (
          <p role="alert" className="text-[14px] text-destructive">
            {(confirm.error ?? decline.error)?.message}
          </p>
        ) : null}
      </div>
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
  starters = [],
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
  // One-press first questions for an empty thread, fitted to what this place can do.
  starters?: string[];
}) {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  // The question being answered shows at once; a turn takes seconds and the composer has already cleared.
  const [asking, setAsking] = useState<string | null>(null);
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
      onError: (_error, input) => {
        setAsking(null);
        setMessage(input.message);
      },
      onSuccess: (result) => {
        if (result.callId !== activeCallId) {
          setStartedCallId(result.callId);
          void queryClient.invalidateQueries({ queryKey: trpc.agent.thread.queryKey({ callId: result.callId }) });
          router.push(`${callsPath}?call=${result.callId}`);
        }
      },
      onSettled: async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.agent.calls.queryKey({ node: listNode }) }),
          queryClient.invalidateQueries({ queryKey: trpc.agent.thread.queryKey() }),
        ]);
        setAsking(null);
      },
    }),
  );

  function send(override?: string) {
    const text = (override ?? message).trim();
    if (!text || ask.isPending) return;
    setAsking(text);
    setMessage("");
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
        onSubmit={() => send()}
        placeholder={activeCallId ? `Reply to ${assistantName}` : "What should we get done?"}
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
    <section aria-label="Thread" className="flex h-full min-h-0 min-w-0 flex-col">
      {activeCallId ? (
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
          <span className="truncate text-sm font-medium">{current?.title ?? ""}</span>
          <Link href={callsPath} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "ml-auto")}>
            New thread
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
        {thread.isError ? <p className="text-sm text-muted-foreground">This thread isn’t available.</p> : null}
        {!activeCallId ? (
          <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center gap-6 py-8">
            <h1 className="flex items-center justify-center gap-3 text-center font-heading text-[29px] leading-tight tracking-[-0.02em]">
              <AgentIcon className="size-7 shrink-0" />
              {firstName ? `Hello, ${firstName}` : "Hello"}
            </h1>
            {composer}
            {available && starters.length > 0 && !asking ? (
              <div className="flex flex-wrap justify-center gap-2">
                {starters.map((starter) => (
                  <Button key={starter} size="sm" variant="outline" onClick={() => send(starter)}>
                    {starter}
                  </Button>
                ))}
              </div>
            ) : null}
            {asking ? (
              <p role="status" className="text-center text-[14px] text-muted-foreground">
                {assistantName} is working on “{asking.slice(0, 80)}”…
              </p>
            ) : null}
            <p className="text-center text-[14px] text-muted-foreground">
              {assistantName} sees only what you can see and prepares quotes, messages and payout decisions. Nothing goes
              out until you approve it.
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
                  className="ml-auto w-fit max-w-[85%] rounded-[14px_14px_4px_14px] bg-secondary px-3.5 py-2.5 text-sm whitespace-pre-wrap"
                >
                  {entry.body}
                </li>
              ) : (
                <li key={entry.id} className="space-y-1">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <AgentIcon className="size-3.5" />
                    {assistantName}
                  </p>
                  <AgentText text={entry.body} />
                </li>
              ),
            )}
            {asking ? (
              <>
                <li className="ml-auto w-fit max-w-[85%] rounded-[14px_14px_4px_14px] bg-secondary px-3.5 py-2.5 text-sm whitespace-pre-wrap">
                  {asking}
                </li>
                <li role="status" className="flex items-center gap-2 text-[14px] text-muted-foreground">
                  <AgentIcon className="size-3.5 motion-safe:animate-pulse" />
                  {assistantName} is reading your records and working on it…
                </li>
              </>
            ) : null}
          </ol>
        ) : null}
      </div>
      {activeCallId ? composer : null}
    </section>
  );

  return <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">{conversation}</div>;
}
