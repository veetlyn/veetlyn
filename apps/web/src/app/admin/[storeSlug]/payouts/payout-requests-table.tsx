"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";

import Loader from "@/components/loader";
import { formatMinor } from "@/lib/money";
import { ADMIN_STATUS_LABELS } from "@/lib/payouts";
import { trpc } from "@/utils/trpc";

import { MarkPaidDialog, type TeamPayoutRequest } from "./mark-paid-dialog";

function RequestRow({
  teamSlug,
  request,
  sendMoneyUrl,
}: {
  teamSlug: string;
  request: TeamPayoutRequest;
  sendMoneyUrl: string;
}) {
  const queryClient = useQueryClient();
  const payDialogRef = useRef<HTMLDialogElement>(null);
  const reject = useMutation(
    trpc.payouts.reject.mutationOptions({
      onSettled: () => queryClient.invalidateQueries({ queryKey: trpc.payouts.list.queryKey({ teamSlug }) }),
    }),
  );

  return (
    <tr className="align-top">
      <td className="px-4 py-3">
        <p className="font-medium">{request.memberName}</p>
        <p className="text-muted-foreground">{request.memberEmail}</p>
      </td>
      <td className="px-4 py-3 break-all">{request.receiverEmail}</td>
      <td className="px-4 py-3 whitespace-nowrap">{formatMinor(request.amountMinor, request.currency)}</td>
      <td className="px-4 py-3 whitespace-nowrap">{new Date(request.createdAt).toLocaleDateString()}</td>
      <td className="space-y-1 px-4 py-3">
        <p>
          {request.status === "paid" && request.paidAt
            ? `Paid ${new Date(request.paidAt).toLocaleDateString()}`
            : ADMIN_STATUS_LABELS[request.status]}
        </p>
        {request.receivedMinor !== null && request.receivedMinor !== request.amountMinor ? (
          <p className="text-muted-foreground">Received {formatMinor(request.receivedMinor, request.currency)}</p>
        ) : null}
        {request.paypalTransactionId ? (
          <p className="text-muted-foreground break-all">Transaction {request.paypalTransactionId}</p>
        ) : null}
        {reject.error ? (
          <p role="alert" className="text-destructive">
            {reject.error.message}
          </p>
        ) : null}
      </td>
      <td className="px-4 py-3">
        {request.status === "requested" ? (
          <>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                disabled={reject.isPending}
                onClick={() => {
                  reject.reset();
                  payDialogRef.current?.showModal();
                }}
              >
                Pay
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={reject.isPending}
                onClick={() => {
                  reject.reset();
                  reject.mutate({ teamSlug, requestId: request.id });
                }}
              >
                {reject.isPending ? "Rejecting…" : "Reject"}
              </Button>
            </div>
            <MarkPaidDialog dialogRef={payDialogRef} teamSlug={teamSlug} request={request} sendMoneyUrl={sendMoneyUrl} />
          </>
        ) : null}
      </td>
    </tr>
  );
}

export function PayoutRequestsTable({ teamSlug }: { teamSlug: string }) {
  const payouts = useQuery({ ...trpc.payouts.list.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });

  return (
    <section aria-labelledby="requests-heading" className="space-y-3">
      <h2 id="requests-heading" className="font-medium">
        Payout requests
      </h2>
      {payouts.isPending ? (
        <Loader />
      ) : payouts.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {payouts.error.message}
        </p>
      ) : payouts.data.requests.length === 0 ? (
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
                  PayPal
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
              {payouts.data.requests.map((request) => (
                <RequestRow
                  key={request.id}
                  teamSlug={teamSlug}
                  request={request}
                  sendMoneyUrl={payouts.data.sendMoneyUrl}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
