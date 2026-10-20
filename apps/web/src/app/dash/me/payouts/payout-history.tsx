"use client";

import { Badge } from "@jendal-workspace/ui/components/badge";
import { useQuery } from "@tanstack/react-query";

import { formatMinor } from "@/lib/money";
import { MEMBER_STATUS_LABELS, PAYOUT_STATUS_TONES, memberPayoutFeeMinor, payoutSentMinor } from "@/lib/payouts";
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
        <ul className="panel divide-y overflow-hidden text-sm">
          {mine.data.requests.map((request) => {
            const sentMinor = payoutSentMinor(request);
            const feeMinor = memberPayoutFeeMinor(request);
            return (
              <li key={request.id} className="space-y-1 px-4 py-3.5">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-medium">
                    {request.teamName} · <span className="font-tabular">{formatMinor(request.amountMinor, request.currency)}</span>
                  </span>
                  <Badge tone={PAYOUT_STATUS_TONES[request.status]}>{MEMBER_STATUS_LABELS[request.status]}</Badge>
                </div>
                {request.source === "project" && request.projectTitle ? (
                  <p className="text-muted-foreground">For {request.projectTitle}</p>
                ) : null}
                <p className="text-muted-foreground">
                  {request.source === "project" ? "Created" : "Requested"} {new Date(request.createdAt).toLocaleDateString()}
                </p>
                {sentMinor !== null ? (
                  <p className="text-muted-foreground">Sent {formatMinor(sentMinor, request.currency)}</p>
                ) : null}
                {feeMinor !== null ? (
                  <p className="text-muted-foreground">PayPal's fee {formatMinor(feeMinor, request.currency)}</p>
                ) : null}
                {request.status === "failed" && request.failureMessage ? (
                  <p className="text-destructive">{request.failureMessage}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
