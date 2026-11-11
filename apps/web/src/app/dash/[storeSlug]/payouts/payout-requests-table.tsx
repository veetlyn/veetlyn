"use client";

import { Badge } from "@jendal-workspace/ui/components/badge";
import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { buttonVariants } from "@jendal-workspace/ui/lib/button-variants";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Search } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import Loader from "@/components/loader";
import { formatMinor } from "@/lib/money";
import {
  approvalState,
  payoutActions,
  payoutSentMinor,
  payoutStatusLabel,
  payoutStatusTone,
  waitingLine,
} from "@/lib/payouts";
import { trpc } from "@/utils/trpc";

import { ConfirmDialog } from "./confirm-dialog";

const DATE = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

type TeamPayouts = inferRouterOutputs<AppRouter>["payouts"]["list"];
export type TeamPayoutRequest = TeamPayouts["payouts"][number];

// What approving does next: wait for another admin, wait for an export (no automatic payouts), or send.
function approveDialogCopy(request: TeamPayoutRequest, amount: string, automaticPayoutsOn: boolean) {
  if (request.approvalsNeeded > 1) {
    return {
      title: `Approve ${amount} for ${request.memberName}?`,
      body: "A second admin has to approve it too before it is sent.",
      confirmLabel: "Approve",
    };
  }
  if (!automaticPayoutsOn) {
    return {
      title: `Approve ${amount} for ${request.memberName}?`,
      body: "It waits for export or for automatic payouts.",
      confirmLabel: "Approve",
    };
  }
  return {
    title: `Send ${amount} to ${request.memberName}?`,
    body: "PayPal sends it from your PayPal account, on payday if the team has one.",
    confirmLabel: `Send ${amount}`,
  };
}

function PayoutSource({ teamSlug, request }: { teamSlug: string; request: TeamPayoutRequest }) {
  if (request.source === "member") return <>Request</>;
  const title = request.projectTitle ?? "Project";
  return request.projectId ? (
    <Link href={`/${teamSlug}/projects/${request.projectId}`} className="underline underline-offset-4">
      {title}
    </Link>
  ) : (
    <>{title}</>
  );
}

// One line per payout: who, from what, how much reaches them, where it stands. Decisions happen on the payout's own
// page, where the amounts, the approvals and the destination are shown before anyone confirms.
function RequestRow({
  teamSlug,
  request,
  needsViewer,
}: {
  teamSlug: string;
  request: TeamPayoutRequest;
  needsViewer: boolean;
}) {
  const sentMinor = payoutSentMinor(request);
  const waiting = waitingLine(request, new Date());
  const approval = approvalState(request);
  const detail =
    request.failureMessage ?? approval.note ?? approval.progress ?? waiting ?? (request.status === "succeeded" && request.settledAt ? `Paid ${DATE.format(new Date(request.settledAt))}` : null);

  return (
    <tr className="align-top">
      <td className="px-4 py-3">
        <Link href={`/${teamSlug}/payouts/${request.id}`} className="font-medium hover:underline">
          {request.memberName}
        </Link>
        <p className="text-muted-foreground">Requested {DATE.format(new Date(request.createdAt))}</p>
      </td>
      <td className="px-4 py-3">
        <PayoutSource teamSlug={teamSlug} request={request} />
      </td>
      <td className="px-4 py-3 whitespace-nowrap">
        <p className="font-tabular">{formatMinor(request.amountMinor, request.currency)}</p>
        {sentMinor !== null ? (
          <p className="font-tabular text-muted-foreground">
            {request.status === "succeeded" ? "Received" : "Receives"} {formatMinor(sentMinor, request.currency)}
          </p>
        ) : null}
      </td>
      <td className="space-y-1 px-4 py-3">
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={payoutStatusTone(request)}>{payoutStatusLabel(request)}</Badge>
          {request.reviewReason ? <Badge tone="warn">Needs review</Badge> : null}
        </div>
        {detail ? <p className={request.failureMessage ? "text-destructive" : "text-muted-foreground"}>{detail}</p> : null}
      </td>
      <td className="px-4 py-3 text-right">
        <Link
          href={`/${teamSlug}/payouts/${request.id}`}
          className={buttonVariants({ variant: needsViewer ? "default" : "outline", size: "sm" })}
          aria-label={`${needsViewer ? "Review" : "Open"} ${request.memberName}'s payout of ${formatMinor(request.amountMinor, request.currency)}`}
        >
          {needsViewer ? "Review" : request.status === "succeeded" ? "Receipt" : "Open"}
        </Link>
      </td>
    </tr>
  );
}

// The decisions a payout allows, in the table and on its own page.
export function PayoutActions({
  teamSlug,
  request,
  automaticPayoutsOn,
  ownPayout,
}: {
  teamSlug: string;
  request: TeamPayoutRequest;
  automaticPayoutsOn: boolean;
  ownPayout: boolean;
}) {
  const queryClient = useQueryClient();
  const approveDialogRef = useRef<HTMLDialogElement>(null);
  const authority = useQuery({ ...trpc.payouts.list.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const cancelExportDialogRef = useRef<HTMLDialogElement>(null);
  // onSettled: a failed send still changes the request (held, or left unconfirmed), so the row must reload either way.
  const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.payouts.list.queryKey({ teamSlug }) });
  const approve = useMutation(
    trpc.payouts.approve.mutationOptions({
      onSuccess: (result) => {
        if (result.approvalsNeeded > 0) toast.success("Approved. Waiting for a second admin.");
      },
      onSettled: invalidate,
    }),
  );
  const reject = useMutation(trpc.payouts.reject.mutationOptions({ onSettled: invalidate }));
  const retry = useMutation(trpc.payouts.retry.mutationOptions({ onSettled: invalidate }));
  const refresh = useMutation(trpc.payouts.refresh.mutationOptions({ onSettled: invalidate }));
  const cancelExport = useMutation(trpc.payouts.cancelExport.mutationOptions({ onSettled: invalidate }));

  const mutations = [approve, reject, retry, refresh, cancelExport];
  const pending = mutations.some((mutation) => mutation.isPending);
  const error = mutations.find((mutation) => mutation.error)?.error ?? null;
  const actions = payoutActions(request, automaticPayoutsOn);
  const amount = formatMinor(request.amountMinor, request.currency);
  const dialog = approveDialogCopy(request, amount, automaticPayoutsOn);
  const input = { teamSlug, requestId: request.id };

  function resetErrors() {
    for (const mutation of mutations) mutation.reset();
  }

  if (!authority.data?.canDecide) return null;

  return (
    <>
        <div className="flex justify-end gap-2">
          {actions.includes("approve") && !ownPayout ? (
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => {
                resetErrors();
                approveDialogRef.current?.showModal();
              }}
            >
              {approve.isPending ? "Approving…" : "Approve"}
            </Button>
          ) : null}
          {actions.includes("reject") ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                resetErrors();
                reject.mutate(input);
              }}
            >
              {reject.isPending ? "Rejecting…" : "Reject"}
            </Button>
          ) : null}
          {actions.includes("retry") ? (
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => {
                resetErrors();
                retry.mutate(input);
              }}
            >
              {retry.isPending ? "Sending…" : "Retry"}
            </Button>
          ) : null}
          {actions.includes("refresh") ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                resetErrors();
                refresh.mutate(input);
              }}
            >
              {refresh.isPending ? "Checking…" : "Refresh"}
            </Button>
          ) : null}
          {actions.includes("cancel_export") ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                resetErrors();
                cancelExportDialogRef.current?.showModal();
              }}
            >
              {cancelExport.isPending ? "Cancelling…" : "Cancel export"}
            </Button>
          ) : null}
        </div>
        <ConfirmDialog
          dialogRef={approveDialogRef}
          id={`approve-dialog-${request.id}`}
          title={dialog.title}
          body={dialog.body}
          confirmLabel={dialog.confirmLabel}
          onConfirm={() => approve.mutate(input)}
        />
        <ConfirmDialog
          dialogRef={cancelExportDialogRef}
          id={`cancel-export-dialog-${request.id}`}
          title={`Cancel the export of ${amount} for ${request.memberName}?`}
          body="Only cancel if you did not send this file in PayPal. If PayPal already paid it, importing PayPal's log still settles it."
          confirmLabel="Cancel export"
          onConfirm={() => cancelExport.mutate(input)}
        />
      {error ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error.message}
        </p>
      ) : null}
    </>
  );
}

function WaitingForMembers({ waiting }: { waiting: TeamPayouts["waitingForDestination"] }) {
  if (waiting.length === 0) return null;
  return (
    <section aria-labelledby="waiting-members-heading" className="space-y-2">
      <h3 id="waiting-members-heading" className="text-sm font-medium">
        Waiting for members
      </h3>
      <ul className="space-y-1 text-sm text-muted-foreground">
        {waiting.map((item) => (
          <li key={item.projectId}>
            Waiting for {item.memberName} to connect PayPal: {item.title} ({formatMinor(item.earningsMinor, item.currency)})
          </li>
        ))}
      </ul>
    </section>
  );
}

const FILTERS = [
  ["all", "All"],
  ["needs", "Needs approval"],
  ["moving", "On its way"],
  ["paid", "Paid"],
] as const;
type Filter = (typeof FILTERS)[number][0];

function inFilter(request: TeamPayoutRequest, filter: Filter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "needs":
      return request.status === "requested";
    case "moving":
      return request.status === "queued" || request.status === "sending" || request.status === "sent" || request.status === "exported";
    case "paid":
      return request.status === "succeeded";
  }
}

function RequestsList({
  teamSlug,
  data,
  automaticPayoutsOn,
  viewerId,
}: {
  teamSlug: string;
  data: TeamPayouts;
  automaticPayoutsOn: boolean;
  viewerId: string;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  // What this viewer can approve now: someone else's payout still waiting for an approval.
  const needsViewer = (request: TeamPayoutRequest) =>
    data.canDecide && request.userId !== viewerId && payoutActions(request, automaticPayoutsOn).includes("approve");
  const mine = data.payouts.filter(needsViewer);
  const term = search.trim().toLocaleLowerCase();
  const matching = data.payouts.filter(
    (request) => inFilter(request, filter) && `${request.memberName} ${request.memberEmail} ${request.projectTitle ?? "request"}`.toLocaleLowerCase().includes(term),
  );

  if (data.payouts.length === 0) {
    return (
      <section className="rounded-[10px] border px-5 py-10 text-center">
        <h2 className="font-heading text-lg">No payout requests yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">Members ask for a payout of their earnings from their own Payouts page.</p>
      </section>
    );
  }
  const first = mine[0];
  const currency = first?.currency;
  const sameCurrency = currency !== undefined && mine.every((request) => request.currency === currency);
  return (
    <>
      {data.canDecide ? (
        first ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border px-5 py-4">
            <div className="grid gap-0.5">
              <p className="font-medium">
                {mine.length === 1 ? "1 payout needs your approval" : `${mine.length} payouts need your approval`}
              </p>
              <p className="text-sm text-muted-foreground">
                {sameCurrency ? `${formatMinor(mine.reduce((sum, request) => sum + request.amountMinor, 0), currency)} requested. ` : ""}
                PayPal&apos;s fee comes off each payout.
              </p>
            </div>
            <Link href={`/${teamSlug}/payouts/${first.id}`} className={buttonVariants({ variant: "mint" })}>
              Review the next one
            </Link>
          </div>
        ) : (
          <div className="rounded-[10px] border px-5 py-4">
            <p className="font-medium">Nothing needs your approval</p>
          </div>
        )
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="relative w-full sm:max-w-64">
          <span className="sr-only">Search payouts by member or source</span>
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" aria-hidden="true" />
          <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search member or source…" className="pl-9" />
        </label>
        <div role="group" aria-label="Show" className="inline-flex w-fit flex-wrap rounded-[8px] border p-0.5">
          {FILTERS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-[0_0_0_1px_var(--input)]"
            >
              {label} <span className="font-tabular text-xs text-muted-foreground">{data.payouts.filter((request) => inFilter(request, key)).length}</span>
            </button>
          ))}
        </div>
      </div>
      <p role="status" className="sr-only">{matching.length} payouts shown</p>
      {matching.length === 0 ? (
        <div className="rounded-[10px] border px-5 py-10 text-center">
          <h2 className="font-heading text-lg">No matching payouts</h2>
          <p className="mt-2 text-sm text-muted-foreground">Try another member, project or status.</p>
          <Button type="button" variant="outline" className="mt-4" onClick={() => { setSearch(""); setFilter("all"); }}>
            Clear filters
          </Button>
        </div>
      ) : (
        <div className="panel relative overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-secondary/60 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">Member</th>
                <th scope="col" className="px-4 py-2.5 font-medium">From</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Amount</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                <th scope="col" className="px-4 py-2.5 font-medium"><span className="sr-only">Open</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {matching.map((request) => (
                <RequestRow key={request.id} teamSlug={teamSlug} request={request} needsViewer={needsViewer(request)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function PayoutRequestsTable({ teamSlug, viewerId }: { teamSlug: string; viewerId: string }) {
  const requests = useQuery({ ...trpc.payouts.list.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  // Whether a queued payout can be retried here depends on automatic payouts, as on the payout's own page.
  const credentials = useQuery({
    ...trpc.payouts.credentials.queryOptions({ teamSlug }),
    retry: false,
    meta: { silent: true },
  });
  const automaticPayoutsOn = credentials.data != null;

  return (
    <section aria-label="Payout requests" className="space-y-4">
      {requests.isPending ? (
        <Loader />
      ) : requests.isError ? (
        <div role="alert" className="space-y-3 rounded-[10px] border p-5 text-sm">
          <p>{requests.error.message}</p>
          {requests.error.data?.code !== "FORBIDDEN" ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void requests.refetch()}>Try again</Button>
          ) : null}
        </div>
      ) : (
        <>
          <RequestsList teamSlug={teamSlug} data={requests.data} automaticPayoutsOn={automaticPayoutsOn} viewerId={viewerId} />
          <WaitingForMembers waiting={requests.data.waitingForDestination} />
        </>
      )}
    </section>
  );
}
