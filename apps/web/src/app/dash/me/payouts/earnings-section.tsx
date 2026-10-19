"use client";

import { MAX_PAYOUT_MINOR, OPEN_PAYOUT_REQUEST_STATUSES, type PayoutRequestStatus } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import Loader from "@/components/loader";
import { formatMinor, minorToPriceInput, parsePriceInput } from "@/lib/money";
import { payoutNetMinor } from "@/lib/payouts";
import { trpc } from "@/utils/trpc";

type MemberPayouts = inferRouterOutputs<AppRouter>["payouts"]["mine"];
type TeamEarnings = MemberPayouts["earnings"][number];

const OPEN_STATUSES: readonly PayoutRequestStatus[] = OPEN_PAYOUT_REQUEST_STATUSES;

// Project payouts reserve money too, but only the member's own open request blocks another one.
function hasOwnOpenRequest(requests: MemberPayouts["requests"], earnings: TeamEarnings): boolean {
  return requests.some(
    (request) =>
      request.source === "member" &&
      request.teamSlug === earnings.teamSlug &&
      request.currency === earnings.currency &&
      OPEN_STATUSES.includes(request.status),
  );
}

function TeamEarningsCard({
  earnings,
  ownRequestOpen,
  requestBlockedReason,
}: {
  earnings: TeamEarnings;
  ownRequestOpen: boolean;
  requestBlockedReason: string | null;
}) {
  const queryClient = useQueryClient();
  // null follows the available amount, so the field refills after each request.
  const [amount, setAmount] = useState<string | null>(null);
  const request = useMutation(
    trpc.payouts.request.mutationOptions({
      onSuccess: async () => {
        setAmount(null);
        await queryClient.invalidateQueries({ queryKey: trpc.payouts.mine.queryKey() });
      },
    }),
  );

  const value = amount ?? minorToPriceInput(Math.min(earnings.availableMinor, MAX_PAYOUT_MINOR));
  const inputId = `payout-amount-${earnings.teamId}-${earnings.currency}`;
  const disabled = earnings.availableMinor === 0 || ownRequestOpen || requestBlockedReason !== null;
  const amountMinor = parsePriceInput(value);
  const net =
    amountMinor !== null && amountMinor > 0
      ? payoutNetMinor({
          amountMinor,
          currency: earnings.currency,
          senderCountry: earnings.senderCountry,
          receiverCountry: earnings.receiverCountry,
        })
      : null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    request.mutate({ teamSlug: earnings.teamSlug, amount: value });
  }

  return (
    <li className="panel space-y-4 p-5">
      <h3 className="font-medium">{earnings.teamName}</h3>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div className="space-y-0.5">
          <dt className="text-muted-foreground">Available</dt>
          <dd className="font-tabular text-base">{formatMinor(earnings.availableMinor, earnings.currency)}</dd>
        </div>
        <div className="space-y-0.5">
          <dt className="text-muted-foreground">In progress</dt>
          <dd className="font-tabular text-base">{formatMinor(earnings.reservedMinor, earnings.currency)}</dd>
        </div>
        <div className="space-y-0.5">
          <dt className="text-muted-foreground">Paid out</dt>
          <dd className="font-tabular text-base">{formatMinor(earnings.paidOutMinor, earnings.currency)}</dd>
        </div>
      </dl>
      <form onSubmit={handleSubmit} className="space-y-2">
        <Label htmlFor={inputId}>Amount ({earnings.currency})</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id={inputId}
            value={value}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="max-w-40"
            disabled={disabled}
            required
          />
          <Button type="submit" disabled={disabled || request.isPending}>
            {request.isPending ? "Requesting…" : "Request payout"}
          </Button>
        </div>
        {net === null ? null : net.tooSmall ? (
          <p className="text-sm text-muted-foreground">{net.tooSmall}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            You'll receive about {formatMinor(net.netMinor, earnings.currency)} after PayPal's fee of about{" "}
            {formatMinor(net.feeEstimateMinor, earnings.currency)}.
          </p>
        )}
        {ownRequestOpen ? (
          <p className="text-sm text-muted-foreground">Your payout request for this team is still in progress.</p>
        ) : null}
        {earnings.availableMinor > 0 && requestBlockedReason ? (
          <p className="text-sm text-muted-foreground">{requestBlockedReason}</p>
        ) : null}
        {request.error ? (
          <p role="alert" className="text-sm text-destructive">
            {request.error.message}
          </p>
        ) : null}
        {request.isSuccess ? (
          <p className="text-sm font-medium text-brand-text">
            {request.data.status === "requested"
              ? `Payout requested. An admin of ${earnings.teamName} reviews it.`
              : "Payout approved. It is on its way to your PayPal account."}
          </p>
        ) : null}
      </form>
    </li>
  );
}

export function EarningsSection({ requestBlockedReason }: { requestBlockedReason: string | null }) {
  const mine = useQuery({ ...trpc.payouts.mine.queryOptions(), meta: { silent: true } });

  return (
    <section aria-labelledby="earnings-heading" className="space-y-3">
      <h2 id="earnings-heading" className="font-medium">
        Earnings
      </h2>
      {mine.isPending ? (
        <Loader />
      ) : mine.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {mine.error.message}
        </p>
      ) : mine.data.earnings.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No earnings yet. Your share of a project shows up here once the client has paid and the project is complete.
        </p>
      ) : (
        <ul className="space-y-3">
          {mine.data.earnings.map((earnings) => (
            <TeamEarningsCard
              key={`${earnings.teamId}-${earnings.currency}`}
              earnings={earnings}
              ownRequestOpen={hasOwnOpenRequest(mine.data.requests, earnings)}
              requestBlockedReason={requestBlockedReason}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
