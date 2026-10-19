"use client";

import { formatMoney, money } from "@jendal-workspace/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import Loader from "@/components/loader";
import { clientPageReferrer, type PayPageState, payPageState, paymentKindLabel } from "@/lib/pay-page";
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
    meta: { silent: true },
  });
  const statusRef = useRef<HTMLParagraphElement>(null);
  const previousView = useRef<PayPageState["view"] | null>(null);
  const [backTo, setBackTo] = useState<string | null>(null);

  // The referrer exists only in the browser.
  useEffect(() => {
    setBackTo(clientPageReferrer(document.referrer, window.location.origin));
  }, []);

  const data = view.data;
  const state = data
    ? payPageState({
        kind: data.payment.kind,
        status: data.payment.status,
        processing: data.payment.processing,
        paypalReady: data.paypal !== null,
      })
    : null;
  const currentView = state?.view ?? null;

  // Move focus to the result when the page changes under the client (after a capture), not on first load.
  useEffect(() => {
    if (currentView === null) return;
    const previous = previousView.current;
    previousView.current = currentView;
    if (previous !== null && previous !== currentView && currentView !== "pay") statusRef.current?.focus();
  }, [currentView]);

  if (view.isPending) return <Loader />;
  // A failed refetch keeps the last data, so a missed poll does not replace the page with this message.
  if (!data || !state) {
    return (
      <main className="mx-auto w-full max-w-lg space-y-4 px-4 py-10 md:px-7 md:py-16">
        <h1 className="font-[family-name:var(--font-display)] text-3xl">This link is not valid</h1>
        <p className="text-sm text-muted-foreground">Ask the team to send you the payment link again.</p>
      </main>
    );
  }

  const { payment, project, team, paypal } = data;
  const currency = payment.currency;

  const paid = state.view === "paid";

  return (
    <main className="mx-auto grid w-full max-w-md gap-5 px-4 py-10 md:py-16">
      <div className="tray">
        <div className="panel grid gap-5 p-6">
          <div className="grid gap-1">
            <p className="text-sm text-muted-foreground">{team.name}</p>
            <h1 className="font-[family-name:var(--font-display)] text-2xl">{project.title}</h1>
            <p className="text-sm text-muted-foreground">{paymentKindLabel(payment.kind)}</p>
          </div>
          <p className="font-tabular text-4xl font-semibold tracking-tight">{formatMoney(money(currency, payment.amountMinor))}</p>
          <ul className="grid gap-2 border-t pt-4 text-sm">
            {payment.lines.map((line, index) => (
              <li key={index} className="flex justify-between gap-4">
                <span className="text-muted-foreground">{line.label}</span>
                <span className="font-tabular">{formatMoney(money(currency, line.amountMinor))}</span>
              </li>
            ))}
            <li className="flex justify-between gap-4 border-t pt-2 font-semibold">
              <span>Total</span>
              <span className="font-tabular">{formatMoney(money(currency, payment.amountMinor))}</span>
            </li>
          </ul>
          {state.view === "pay" && paypal ? (
            <PayPalCheckout token={token} currency={payment.currency} paypal={paypal} />
          ) : (
            <p
              ref={statusRef}
              tabIndex={-1}
              role="status"
              className={
                paid
                  ? "flex items-center gap-2 rounded-lg bg-brand-wash px-3 py-2.5 text-sm font-semibold text-foreground"
                  : "text-sm text-muted-foreground"
              }
            >
              {paid ? (
                <span aria-hidden="true" className="grid size-5 place-items-center rounded-md bg-brand text-xs text-brand-foreground">
                  ✓
                </span>
              ) : null}
              {state.view === "pay" ? null : state.message}
            </p>
          )}
        </div>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        You pay {team.name} through PayPal. Your card and bank details stay with PayPal.
      </p>
      {backTo ? (
        <a href={backTo} className="justify-self-center text-sm underline decoration-border underline-offset-4 hover:decoration-foreground">
          Back to your project
        </a>
      ) : null}
    </main>
  );
}
