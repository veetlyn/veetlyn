"use client";

import { Badge } from "@jendal-workspace/ui/components/badge";
import { Button } from "@jendal-workspace/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRef } from "react";
import { toast } from "sonner";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import Loader from "@/components/loader";
import { formatMinor } from "@/lib/money";
import {
  approvalState,
  payoutActions,
  payoutFeeLine,
  payoutSentMinor,
  payoutStatusLabel,
  payoutStatusTone,
  waitingLine,
} from "@/lib/payouts";
import { trpc } from "@/utils/trpc";

import { ConfirmDialog } from "./confirm-dialog";

type TeamPayouts = inferRouterOutputs<AppRouter>["payouts"]["list"];
type TeamPayoutRequest = TeamPayouts["payouts"][number];

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

function RequestRow({
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
  const fee = payoutFeeLine(request);
  const sentMinor = payoutSentMinor(request);
  const waiting = waitingLine(request, new Date());
  const approval = approvalState(request);
  const dialog = approveDialogCopy(request, amount, automaticPayoutsOn);
  const input = { teamSlug, requestId: request.id };

  function resetErrors() {
    for (const mutation of mutations) mutation.reset();
  }

  return (
    <tr className="align-top">
      <td className="px-4 py-3">
        <p className="font-medium">{request.memberName}</p>
        <p className="text-muted-foreground">{request.memberEmail}</p>
      </td>
      <td className="px-4 py-3">
        <PayoutSource teamSlug={teamSlug} request={request} />
      </td>
      <td className="px-4 py-3 font-tabular whitespace-nowrap">{amount}</td>
      <td className="px-4 py-3 font-tabular whitespace-nowrap">{new Date(request.createdAt).toLocaleDateString()}</td>
      <td className="space-y-1.5 px-4 py-3">
        <Badge tone={payoutStatusTone(request)}>{payoutStatusLabel(request)}</Badge>
        {sentMinor !== null ? (
          <p className="text-muted-foreground">
            {request.status === "succeeded" ? "Sent" : "Sends"} {formatMinor(sentMinor, request.currency)}
          </p>
        ) : null}
        {fee ? (
          <p className="text-muted-foreground">
            {fee.label} {formatMinor(fee.feeMinor, request.currency)}
          </p>
        ) : null}
        {request.failureMessage ? <p className="text-destructive">{request.failureMessage}</p> : null}
        {waiting ? <p className="text-muted-foreground">{waiting}</p> : null}
        {approval.progress ? <p className="text-muted-foreground">{approval.progress}</p> : null}
        {approval.note ? <p className="text-muted-foreground">{approval.note}</p> : null}
        {(request.status === "exported" || request.status === "queued") && request.reviewReason ? (
          <p className="text-destructive">{request.reviewReason}</p>
        ) : null}
        {request.reviewReason ? (
          <Badge tone="warn">Needs review</Badge>
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive">
            {error.message}
          </p>
        ) : null}
      </td>
      <td className="px-4 py-3">
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
      </td>
    </tr>
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
  if (data.payouts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No payout requests yet. Members ask for a payout of their earnings from their own Payouts page.
      </p>
    );
  }
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b bg-secondary/60 text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Member
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              From
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Amount
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Requested
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Status
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {data.payouts.map((request) => (
            <RequestRow
              key={request.id}
              teamSlug={teamSlug}
              request={request}
              automaticPayoutsOn={automaticPayoutsOn}
              ownPayout={request.userId === viewerId}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PayoutRequestsTable({ teamSlug, viewerId }: { teamSlug: string; viewerId: string }) {
  const requests = useQuery({ ...trpc.payouts.list.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  // Without automatic payouts an approved payout waits for an export, so the approve dialog says so.
  const credentials = useQuery({
    ...trpc.payouts.credentials.queryOptions({ teamSlug }),
    retry: false,
    meta: { silent: true },
  });
  const automaticPayoutsOn = credentials.data != null;

  return (
    <section aria-labelledby="requests-heading" className="space-y-3">
      <h2 id="requests-heading" className="font-medium">
        Payout requests
      </h2>
      {requests.isPending ? (
        <Loader />
      ) : requests.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {requests.error.message}
        </p>
      ) : (
        <>
          <RequestsList
            teamSlug={teamSlug}
            data={requests.data}
            automaticPayoutsOn={automaticPayoutsOn}
            viewerId={viewerId}
          />
          <WaitingForMembers waiting={requests.data.waitingForDestination} />
        </>
      )}
    </section>
  );
}
