"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import Loader from "@/components/loader";
import { DocumentPage } from "@/components/page-composition";
import { type FinanceSummary, financeSummary } from "@/lib/finance-summary";
import { formatMinor } from "@/lib/money";
import { trpc } from "@/utils/trpc";

function Line({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <div className={strong ? "flex items-baseline justify-between gap-4 border-t pt-4" : "flex items-baseline justify-between gap-4"}>
      <dt className={strong ? "font-medium" : "text-muted-foreground"}>
        {label}
        {note ? <span className="block text-xs text-muted-foreground">{note}</span> : null}
      </dt>
      <dd className={strong ? "shrink-0 font-tabular text-xl font-semibold" : "shrink-0 font-tabular"}>{value}</dd>
    </div>
  );
}

function Statement({ teamSlug, s, showPayouts }: { teamSlug: string; s: FinanceSummary; showPayouts: boolean }) {
  const m = (minor: number) => formatMinor(minor, s.currency);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby={`in-${s.currency}`} className="rounded-lg border bg-card px-5 py-6 sm:px-7">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id={`in-${s.currency}`} className="font-heading text-lg">Received from clients</h2>
          <Link href={`/${teamSlug}/payments`} className="text-sm text-muted-foreground underline underline-offset-4">Payments</Link>
        </div>
        <dl className="mt-5 grid gap-3 text-sm">
          <Line label="Paid by clients" value={m(s.receivedMinor)} />
          <Line label="PayPal fees" value={`−${m(s.feesMinor)}`} note={s.feesUnreported > 0 ? `${s.feesUnreported} ${s.feesUnreported === 1 ? "payment's fee is" : "payments' fees are"} not reported by PayPal yet` : undefined} />
          <Line label="Refunded" value={`−${m(s.refundedMinor)}`} />
          <Line label="Kept after fees and refunds" value={m(s.netMinor)} strong />
          {s.pendingInMinor > 0 ? <Line label="Waiting to be paid" value={m(s.pendingInMinor)} /> : null}
        </dl>
      </section>
      {showPayouts ? (
        <section aria-labelledby={`out-${s.currency}`} className="rounded-lg border bg-card px-5 py-6 sm:px-7">
          <div className="flex items-baseline justify-between gap-4">
            <h2 id={`out-${s.currency}`} className="font-heading text-lg">Paid to members</h2>
            <Link href={`/${teamSlug}/payouts`} className="text-sm text-muted-foreground underline underline-offset-4">Payouts</Link>
          </div>
          <dl className="mt-5 grid gap-3 text-sm">
            <Line label="Waiting for approval" value={m(s.awaitingApprovalMinor)} note={`${s.awaitingApprovalCount} ${s.awaitingApprovalCount === 1 ? "request" : "requests"}`} />
            <Line label="Approved, being sent" value={m(s.inFlightMinor)} />
            <Line label="Received by members" value={m(s.paidOutMinor)} strong />
          </dl>
        </section>
      ) : null}
      {s.openDisputes > 0 ? (
        <p role="status" className="rounded-lg border px-5 py-4 text-sm lg:col-span-2">
          <span className="font-medium">{s.openDisputes} open {s.openDisputes === 1 ? "dispute" : "disputes"}</span>{" "}
          <span className="text-muted-foreground">for {m(s.disputedMinor)}.</span>{" "}
          <Link href={`/${teamSlug}/cases`} className="underline underline-offset-4">See disputes</Link>
        </p>
      ) : null}
    </div>
  );
}

// The team's finances at a glance; Payments, Payouts and Disputes hold the lines behind each figure.
export default function TeamFinances({ teamSlug }: { teamSlug: string }) {
  const quiet = { retry: false, meta: { silent: true } } as const;
  const payments = useQuery({ ...trpc.money.payments.queryOptions({ teamSlug }), ...quiet });
  const payouts = useQuery({ ...trpc.payouts.list.queryOptions({ teamSlug }), ...quiet });
  const cases = useQuery({ ...trpc.money.cases.queryOptions({ teamSlug }), ...quiet });
  if (payments.isPending || payouts.isPending || cases.isPending) return <Loader />;
  if (payments.isError) {
    return (
      <DocumentPage>
        <h1 className="font-heading text-3xl">Finances</h1>
        <p className="text-sm text-muted-foreground">
          {payments.error.data?.code === "FORBIDDEN" ? "You don’t have access to the team’s finances. A team admin can change your access." : payments.error.message}
        </p>
      </DocumentPage>
    );
  }
  const summaries = financeSummary(payments.data, payouts.data?.payouts ?? [], cases.data ?? []);
  return (
    <DocumentPage className="max-w-[1104px]">
      <div className="space-y-1">
        <h1 className="font-heading text-3xl">Finances</h1>
        <p className="text-sm text-muted-foreground">Everything clients paid through PayPal, and what reached members.</p>
      </div>
      {summaries.length === 0 ? (
        <section className="rounded-[10px] border px-5 py-10 text-center">
          <h2 className="font-heading text-lg">No payments yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">Deposits and balances appear here as clients pay.</p>
        </section>
      ) : (
        summaries.map((s) => (
          <div key={s.currency} className="space-y-3">
            {summaries.length > 1 ? <h2 className="text-sm font-medium text-muted-foreground">{s.currency}</h2> : null}
            <Statement teamSlug={teamSlug} s={s} showPayouts={payouts.isSuccess} />
          </div>
        ))
      )}
    </DocumentPage>
  );
}
