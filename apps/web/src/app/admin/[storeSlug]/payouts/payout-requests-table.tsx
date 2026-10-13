"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import Loader from "@/components/loader";
import { formatMinor } from "@/lib/money";
import { payoutActions, payoutFeeLine, payoutSentMinor, payoutStatusLabel } from "@/lib/payouts";
import { trpc } from "@/utils/trpc";

import { ConfirmDialog } from "./confirm-dialog";

type TeamPayoutRequest = inferRouterOutputs<AppRouter>["payouts"]["list"][number];

function RequestRow({
  teamSlug,
  request,
  automaticPayoutsOn,
}: {
  teamSlug: string;
  request: TeamPayoutRequest;
  automaticPayoutsOn: boolean;
}) {
  const queryClient = useQueryClient();
  const approveDialogRef = useRef<HTMLDialogElement>(null);
  // onSettled: a failed send still changes the request (held, or left unconfirmed), so the row must reload either way.
  const invalidate = () => queryClient.invalidateQueries({ queryKey: trpc.payouts.list.queryKey({ teamSlug }) });
  const approve = useMutation(trpc.payouts.approve.mutationOptions({ onSettled: invalidate }));
  const reject = useMutation(trpc.payouts.reject.mutationOptions({ onSettled: invalidate }));
  const retry = useMutation(trpc.payouts.retry.mutationOptions({ onSettled: invalidate }));
  const refresh = useMutation(trpc.payouts.refresh.mutationOptions({ onSettled: invalidate }));

  const mutations = [approve, reject, retry, refresh];
  const pending = mutations.some((mutation) => mutation.isPending);
  const error = mutations.find((mutation) => mutation.error)?.error ?? null;
  const actions = payoutActions(request);
  const amount = formatMinor(request.amountMinor, request.currency);
  const fee = payoutFeeLine(request);
  const sentMinor = payoutSentMinor(request);
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
      <td className="px-4 py-3 whitespace-nowrap">{amount}</td>
      <td className="px-4 py-3 whitespace-nowrap">{new Date(request.createdAt).toLocaleDateString()}</td>
      <td className="space-y-1 px-4 py-3">
        <p>{payoutStatusLabel(request)}</p>
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
        {request.reviewReason ? (
          <span className="inline-block rounded-md bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Needs review
          </span>
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive">
            {error.message}
          </p>
        ) : null}
      </td>
      <td className="px-4 py-3">
        <div className="flex justify-end gap-2">
          {actions.includes("approve") ? (
            <Button
              type="button"
              size="sm"
              disabled={pending || !automaticPayoutsOn}
              onClick={() => {
                resetErrors();
                approveDialogRef.current?.showModal();
              }}
            >
              {approve.isPending ? "Sending…" : "Approve"}
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
        </div>
        {!automaticPayoutsOn && actions.includes("approve") ? (
          <p className="mt-1 text-right text-muted-foreground">Turn on automatic payouts to pay requests.</p>
        ) : null}
        <ConfirmDialog
          dialogRef={approveDialogRef}
          id={`approve-dialog-${request.id}`}
          title={`Send ${amount} to ${request.memberName}?`}
          body="PayPal sends it from your PayPal account."
          confirmLabel={`Send ${amount}`}
          onConfirm={() => approve.mutate(input)}
        />
      </td>
    </tr>
  );
}

export function PayoutRequestsTable({ teamSlug }: { teamSlug: string }) {
  const requests = useQuery({ ...trpc.payouts.list.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  // Approve sends through the team's saved credentials, so it stays off until automatic payouts are on.
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
      ) : requests.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No payout requests yet. Members ask for a payout of their earnings from their own Payouts page.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-normal">
                  Member
                </th>
                <th scope="col" className="px-4 py-2 font-normal">
                  Amount
                </th>
                <th scope="col" className="px-4 py-2 font-normal">
                  Requested
                </th>
                <th scope="col" className="px-4 py-2 font-normal">
                  Status
                </th>
                <th scope="col" className="px-4 py-2 font-normal">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {requests.data.map((request) => (
                <RequestRow key={request.id} teamSlug={teamSlug} request={request} automaticPayoutsOn={automaticPayoutsOn} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
