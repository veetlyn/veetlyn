"use client";

import { useQuery } from "@tanstack/react-query";

import { formatMinor } from "@/lib/money";
import { MEMBER_STATUS_LABELS } from "@/lib/payouts";
import { trpc } from "@/utils/trpc";

// Shares the payouts.mine query with the earnings section, which shows the loading and error states.
export function PayoutHistory() {
  const mine = useQuery({ ...trpc.payouts.mine.queryOptions(), meta: { silent: true } });
  if (!mine.data) return null;

  return (
    <section aria-labelledby="history-heading" className="space-y-3">
      <h2 id="history-heading" className="font-medium">
        History
      </h2>
      {mine.data.requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">No payout requests yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border text-sm">
          {mine.data.requests.map((request) => (
            <li key={request.id} className="space-y-1 px-4 py-3">
              <div className="flex items-center justify-between gap-4">
                <span className="font-medium">
                  {request.teamName} · {formatMinor(request.amountMinor, request.currency)}
                </span>
                <span className="text-muted-foreground">
                  {request.status === "paid" && request.paidAt
                    ? `Paid ${new Date(request.paidAt).toLocaleDateString()}`
                    : MEMBER_STATUS_LABELS[request.status]}
                </span>
              </div>
              <p className="text-muted-foreground">Requested {new Date(request.createdAt).toLocaleDateString()}</p>
              {request.status === "paid" && request.receivedMinor !== null ? (
                <p className="text-muted-foreground">
                  You received {formatMinor(request.receivedMinor, request.currency)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
