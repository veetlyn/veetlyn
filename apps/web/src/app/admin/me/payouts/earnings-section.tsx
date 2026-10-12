"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import Loader from "@/components/loader";
import { formatMinor, minorToPriceInput } from "@/lib/money";
import { trpc } from "@/utils/trpc";

type TeamEarnings = inferRouterOutputs<AppRouter>["payouts"]["mine"]["earnings"][number];

function TeamEarningsCard({
  earnings,
  requestBlockedReason,
}: {
  earnings: TeamEarnings;
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

  const value = amount ?? minorToPriceInput(earnings.availableMinor);
  const inputId = `payout-amount-${earnings.teamId}-${earnings.currency}`;
  const disabled = earnings.availableMinor === 0 || earnings.reservedMinor > 0 || requestBlockedReason !== null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    request.mutate({ teamSlug: earnings.teamSlug, amount: value });
  }

  return (
    <li className="space-y-3 border p-4">
      <h3 className="font-medium">{earnings.teamName}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Available</dt>
        <dd>{formatMinor(earnings.availableMinor, earnings.currency)}</dd>
        <dt className="text-muted-foreground">In progress</dt>
        <dd>{formatMinor(earnings.reservedMinor, earnings.currency)}</dd>
        <dt className="text-muted-foreground">Paid out</dt>
        <dd>{formatMinor(earnings.paidOutMinor, earnings.currency)}</dd>
      </dl>
      <form onSubmit={handleSubmit} className="space-y-2">
        <Label htmlFor={inputId}>Amount ({earnings.currency})</Label>
        <div className="flex gap-2">
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
        <p className="text-sm text-muted-foreground">
          The team pays you in PayPal. PayPal takes its fee when the payment arrives.
        </p>
        {earnings.reservedMinor > 0 ? (
          <p className="text-sm text-muted-foreground">A payout is already in progress for this team.</p>
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
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            Payout requested. {earnings.teamName} pays you in PayPal.
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
              requestBlockedReason={requestBlockedReason}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
