"use client";

import { Badge } from "@jendal-workspace/ui/components/badge";
import { Button } from "@jendal-workspace/ui/components/button";
import type { TableColumn } from "@jendal-workspace/ui/components/motion/table";
import { buttonVariants } from "@jendal-workspace/ui/lib/button-variants";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRef } from "react";
import { toast } from "sonner";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import { DataList } from "@/components/data-list";
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

// The line under a payout's status: why it is waiting, what failed, or when it was paid.
function statusDetail(request: TeamPayoutRequest) {
  const waiting = waitingLine(request, new Date());
  const approval = approvalState(request);
  const text = request.failureMessage ?? approval.note ?? approval.progress ?? waiting ?? (request.status === "succeeded" && request.settledAt ? `Paid ${DATE.format(new Date(request.settledAt))}` : null);
  return { text, destructive: Boolean(request.failureMessage) };
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
  // What this viewer can approve now: someone else's payout still waiting for an approval.
  const needsViewer = (request: TeamPayoutRequest) =>
    data.canDecide && request.userId !== viewerId && payoutActions(request, automaticPayoutsOn).includes("approve");
  const mine = data.payouts.filter(needsViewer);
  const first = mine[0];
  const currency = first?.currency;
  const sameCurrency = currency !== undefined && mine.every((request) => request.currency === currency);
  const stateOf = (request: TeamPayoutRequest) => request.status === "requested"
    ? "needs"
    : request.status === "succeeded"
      ? "paid"
      : ["queued", "sending", "sent", "exported"].includes(request.status)
        ? "moving"
        : "other";
  const currencies = [...new Set(data.payouts.map((request) => request.currency))];
  const columns: TableColumn<TeamPayoutRequest>[] = [
    {
      key: "member",
      header: "Member",
      sortable: true,
      sortValue: (request) => request.memberName.toLocaleLowerCase(),
      cell: (request) => (
        <span className="grid min-w-0">
          <Link href={`/${teamSlug}/payouts/${request.id}`} className="truncate font-medium underline-offset-4 hover:underline">{request.memberName}</Link>
          <span className="truncate text-xs text-muted-foreground">{request.memberEmail}</span>
        </span>
      ),
    },
    { key: "requested", header: "Requested", width: "128px", sortable: true, sortValue: (request) => new Date(request.createdAt).getTime(), cell: (request) => <span className="whitespace-nowrap">{DATE.format(new Date(request.createdAt))}</span> },
    { key: "from", header: "From", width: "190px", cell: (request) => <PayoutSource teamSlug={teamSlug} request={request} /> },
    {
      key: "amount",
      header: "Amount",
      width: "150px",
      align: "right",
      sortable: true,
      sortValue: (request) => request.amountMinor,
      cell: (request) => {
        const sentMinor = payoutSentMinor(request);
        return (
          <span className="grid justify-items-end">
            <span className="whitespace-nowrap tabular-nums">{formatMinor(request.amountMinor, request.currency)}</span>
            {sentMinor !== null ? <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">{request.status === "succeeded" ? "Received" : "Receives"} {formatMinor(sentMinor, request.currency)}</span> : null}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      width: "210px",
      sortable: true,
      sortValue: (request) => payoutStatusLabel(request),
      cell: (request) => {
        const detail = statusDetail(request);
        return (
          <span className="grid gap-1">
            <span className="flex flex-wrap gap-1.5">
              <Badge tone={payoutStatusTone(request)}>{payoutStatusLabel(request)}</Badge>
              {request.reviewReason ? <Badge tone="warn">Needs review</Badge> : null}
            </span>
            {detail.text ? <span className={`truncate text-xs ${detail.destructive ? "text-destructive" : "text-muted-foreground"}`}>{detail.text}</span> : null}
          </span>
        );
      },
    },
    {
      key: "action",
      header: <span className="sr-only">Open</span>,
      width: "116px",
      align: "right",
      cell: (request) => (
        <Link
          href={`/${teamSlug}/payouts/${request.id}`}
          className={buttonVariants({ variant: needsViewer(request) ? "default" : "outline", size: "sm" })}
          aria-label={`${needsViewer(request) ? "Review" : "Open"} ${request.memberName}'s payout of ${formatMinor(request.amountMinor, request.currency)}`}
        >
          {needsViewer(request) ? "Review" : request.status === "succeeded" ? "Receipt" : "Open"}
        </Link>
      ),
    },
  ];

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
            <Link href={`/${teamSlug}/payouts/${first.id}`} className={buttonVariants()}>
              Review the next one
            </Link>
          </div>
        ) : (
          <div className="rounded-[10px] border px-5 py-4">
            <p className="font-medium">Nothing needs your approval</p>
          </div>
        )
      ) : null}
      <DataList
        label="Payout requests"
        rows={data.payouts}
        columns={columns}
        getRowId={(request) => request.id}
        searchText={(request) => `${request.memberName} ${request.memberEmail} ${request.projectTitle ?? "request"}`}
        searchLabel="Search payouts"
        filters={[
          {
            key: "state",
            label: "Payouts",
            options: [
              { value: "needs", label: "Needs approval" },
              { value: "moving", label: "On its way" },
              { value: "paid", label: "Paid" },
              { value: "other", label: "Rejected or failed" },
            ],
            match: (request, value) => stateOf(request) === value,
          },
          ...(currencies.length > 1 ? [{ key: "currency", label: "Currencies", options: currencies.map((value) => ({ value, label: value })), match: (request: TeamPayoutRequest, value: string) => request.currency === value }] : []),
        ]}
        defaultSort={{ key: "requested", direction: "desc" }}
        empty={{ title: "No payout requests yet", text: "Members ask for a payout of their earnings from their own Payouts page." }}
        noun={{ one: "payout", many: "payouts" }}
      />
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
