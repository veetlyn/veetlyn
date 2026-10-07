"use client";

import { formatMoney, money, type MoneyCurrency } from "@jendal-workspace/core";
import { useQuery } from "@tanstack/react-query";

import Loader from "@/components/loader";
import { payPageState, paymentKindLabel } from "@/lib/pay-page";
import { trpc } from "@/utils/trpc";

import PayPalCheckout from "./paypal-checkout";

// The pay page (services spec §5.4): the signed link is the credential and names the payment; the amount
// always comes from the server.
export default function PayPage({ token }: { token: string }) {
  const view = useQuery({
    ...trpc.payment.payGet.queryOptions({ token }),
    retry: false,
    // A pending capture settles on PayPal's side; check back until it does.
    refetchInterval: (query) => (query.state.data?.payment.processing ? 5_000 : false),
  });

  if (view.isPending) return <Loader />;
  if (view.isError) {
    return (
      <main className="container mx-auto max-w-lg space-y-4 px-4 py-16">
        <h1 className="text-2xl font-semibold">This link is not valid</h1>
        <p className="text-sm text-muted-foreground">Ask the team to send you the payment link again.</p>
      </main>
    );
  }

  const { payment, project, team, paypal, clientPath } = view.data;
  const currency = payment.currency as MoneyCurrency;
  const state = payPageState({
    kind: payment.kind,
    status: payment.status,
    processing: payment.processing,
    paypalReady: paypal !== null,
  });

  return (
    <main className="container mx-auto max-w-lg space-y-6 px-4 py-10">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">{team.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{project.title}</h1>
        <p className="text-sm text-muted-foreground">{paymentKindLabel(payment.kind)}</p>
      </div>

      <ul className="space-y-1 rounded-lg border p-4 text-sm">
        {payment.lines.map((line, index) => (
          <li key={index} className="flex justify-between gap-4">
            <span>{line.label}</span>
            <span className="tabular-nums">{formatMoney(money(currency, line.amountMinor))}</span>
          </li>
        ))}
        <li className="flex justify-between gap-4 border-t pt-2 font-medium">
          <span>Total</span>
          <span className="tabular-nums">{formatMoney(money(currency, payment.amountMinor))}</span>
        </li>
      </ul>

      {state.view === "pay" && paypal ? (
        <PayPalCheckout token={token} currency={payment.currency} paypal={paypal} />
      ) : (
        <p role="status" className={state.view === "paid" ? "font-medium" : "text-sm text-muted-foreground"}>
          {state.view === "pay" ? null : state.message}
        </p>
      )}

      <a href={clientPath} className="text-sm underline underline-offset-4">
        Back to the project
      </a>
    </main>
  );
}
