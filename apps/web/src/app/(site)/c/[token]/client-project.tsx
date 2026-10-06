"use client";

import { formatMoney, money, projectStatusLabel, type MoneyCurrency } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import Loader from "@/components/loader";
import { trpc } from "@/utils/trpc";

// The client project page (services spec §5.2): the signed link is the credential, so this page
// works without an account. Accepting a quote or an amendment is one click from here.
export default function ClientProject({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const view = useQuery({ ...trpc.project.clientGet.queryOptions({ token }), retry: false });
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.project.clientGet.queryOptions({ token }).queryKey });

  const acceptQuote = useMutation(trpc.project.clientAcceptQuote.mutationOptions({ onSuccess: refresh }));
  const acceptAmendment = useMutation(trpc.project.clientAcceptAmendment.mutationOptions({ onSuccess: refresh }));
  const declineAmendment = useMutation(trpc.project.clientDeclineAmendment.mutationOptions({ onSuccess: refresh }));

  if (view.isPending) return <Loader />;
  if (view.isError) {
    return (
      <main className="container mx-auto max-w-2xl space-y-4 px-4 py-16">
        <h1 className="text-2xl font-semibold">This link is not valid</h1>
        <p className="text-sm text-muted-foreground">Ask the team to send you the project link again.</p>
      </main>
    );
  }

  const { project, quotes, amendments, payments } = view.data;
  const currency = project.currency as MoneyCurrency;
  const pendingPayments = payments.filter((p) => p.status === "pending");
  const actionError = acceptQuote.error ?? acceptAmendment.error ?? declineAmendment.error;

  return (
    <main className="container mx-auto max-w-2xl space-y-8 px-4 py-10">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{project.title}</h1>
        <p className="text-sm text-muted-foreground">{projectStatusLabel(project.status)}</p>
        {project.brief ? <p className="text-sm">{project.brief}</p> : null}
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Quotes</h2>
        {quotes.length === 0 ? <p className="text-sm text-muted-foreground">The team is preparing your quote.</p> : null}
        {quotes.map((quote) => (
          <div key={quote.id} className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <p className="font-medium">
                {formatMoney(money(currency, quote.amountMinor))} · delivery in {quote.deliveryDays} days
              </p>
              <span className="text-sm text-muted-foreground">{quote.status === "proposed" ? "Waiting for you" : quote.status}</span>
            </div>
            <ul className="space-y-1 text-sm">
              {quote.items.map((item) => (
                <li key={item.id} className="flex justify-between gap-4">
                  <span>{item.description}</span>
                  <span>{formatMoney(money(currency, item.amountMinor))}</span>
                </li>
              ))}
            </ul>
            {quote.status === "proposed" && project.status === "quoting" ? (
              <Button
                disabled={acceptQuote.isPending}
                onClick={() => acceptQuote.mutate({ token, quoteId: quote.id })}
              >
                Accept quote
              </Button>
            ) : null}
          </div>
        ))}
      </section>

      {amendments.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Amendments</h2>
          {amendments.map((amendment) => (
            <div key={amendment.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  {amendment.deltaMinor > 0 ? "+" : ""}
                  {formatMoney(money(currency, amendment.deltaMinor))} → new total{" "}
                  {formatMoney(money(currency, amendment.newAmountMinor))}
                </p>
                <span className="text-sm text-muted-foreground">{amendment.status === "pending" ? "Waiting for you" : amendment.status}</span>
              </div>
              {amendment.addItems.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {amendment.addItems.map((item, index) => (
                    <li key={index} className="flex justify-between gap-4">
                      <span>+ {item.description}</span>
                      <span>{formatMoney(money(currency, item.amountMinor))}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {amendment.note ? <p className="text-sm">{amendment.note}</p> : null}
              {amendment.status === "pending" ? (
                <div className="flex gap-2">
                  <Button
                    disabled={acceptAmendment.isPending || declineAmendment.isPending}
                    onClick={() => acceptAmendment.mutate({ token, amendmentId: amendment.id })}
                  >
                    Accept amendment
                  </Button>
                  <Button
                    variant="outline"
                    disabled={acceptAmendment.isPending || declineAmendment.isPending}
                    onClick={() => declineAmendment.mutate({ token, amendmentId: amendment.id })}
                  >
                    Decline
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {payments.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Payments</h2>
          {payments.map((payment) => (
            <div key={payment.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex items-center justify-between text-sm">
                <p className="font-medium capitalize">{payment.kind.replace("_", "-")}</p>
                <span className="text-muted-foreground">{payment.status}</span>
              </div>
              <ul className="space-y-1 text-sm">
                {payment.lines.map((line, index) => (
                  <li key={index} className="flex justify-between gap-4">
                    <span>{line.label}</span>
                    <span>{formatMoney(money(currency, line.amountMinor))}</span>
                  </li>
                ))}
                <li className="flex justify-between gap-4 font-medium">
                  <span>Total</span>
                  <span>{formatMoney(money(currency, payment.amountMinor))}</span>
                </li>
              </ul>
              {payment.status === "pending" ? (
                <div className="space-y-1">
                  <Button disabled>Pay with PayPal</Button>
                  <p className="text-xs text-muted-foreground">Payment coming soon — the team will share the pay link shortly.</p>
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {pendingPayments.length === 0 && quotes.every((q) => q.status !== "proposed") && amendments.every((a) => a.status !== "pending") ? (
        <p className="text-sm text-muted-foreground">Nothing is waiting for you right now.</p>
      ) : null}
      {actionError ? <p className="text-sm text-destructive">{actionError.message}</p> : null}
    </main>
  );
}
