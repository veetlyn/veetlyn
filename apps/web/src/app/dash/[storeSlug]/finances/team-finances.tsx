"use client";

import { LineChart, LineChartLegend, LineChartPlot, type LineChartSeries, LineChartTooltip } from "@jendal-workspace/ui/components/charts/line-chart";
import { Tabs, TabsList, TabsTrigger } from "@jendal-workspace/ui/components/motion/tabs";
import { nativeSelectClass } from "@jendal-workspace/ui/lib/native-select";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";

import { DataList } from "@/components/data-list";
import Loader from "@/components/loader";
import { ListPage } from "@/components/page-composition";
import { RecordCard } from "@/components/record-card";
import { type AnalyticsRange, collectionAnalytics } from "@/lib/finance-analytics";
import { financeSummary } from "@/lib/finance-summary";
import { formatMinor } from "@/lib/money";
import { PAYMENT_KIND_LABELS } from "@/lib/status-labels";
import { trpc } from "@/utils/trpc";

const RANGES: readonly { value: AnalyticsRange; label: string; previousLabel: string }[] = [
  { value: "7d", label: "7 days", previousLabel: "previous 7 days" },
  { value: "30d", label: "30 days", previousLabel: "previous 30 days" },
  { value: "90d", label: "90 days", previousLabel: "previous 90 days" },
  { value: "12m", label: "12 months", previousLabel: "previous 12 months" },
  { value: "all", label: "All time", previousLabel: "previous period" },
];

function isRange(value: string): value is AnalyticsRange {
  return RANGES.some((range) => range.value === value);
}

function percent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

function growth(value: number | null): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function bucketLabel(start: string, range: AnalyticsRange): string {
  const date = new Date(start);
  return range === "12m" || range === "all"
    ? date.toLocaleDateString("en", { month: "short", year: "numeric", timeZone: "UTC" })
    : date.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
}

function periodLabel(range: AnalyticsRange, start: string | null, end: string): string {
  const endDate = new Date(end);
  const endLabel = new Date(endDate.getTime() - 1).toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  if (!start) return `All dated activity through ${endLabel}`;
  const startDate = new Date(start);
  if (range === "12m" || range === "all") {
    return `${startDate.toLocaleDateString("en", { month: "short", year: "numeric", timeZone: "UTC" })} – ${endLabel}`;
  }
  return `${startDate.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })} – ${endLabel}`;
}

function Kpi({ label, value, note, href }: { label: string; value: string; note: string; href?: string }) {
  const content = (
    <>
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="mt-1 font-tabular text-[26px] leading-none font-semibold tracking-[-0.02em]">{value}</p>
      <p className="mt-2 text-[13px] text-muted-foreground">{note}</p>
    </>
  );
  const className = "rounded-[10px] border bg-card px-4 py-4";
  return href ? (
    <Link href={href} className={`${className} transition-colors hover:bg-accent/50`}>
      {content}
    </Link>
  ) : (
    <div className={className}>{content}</div>
  );
}

function ReconciliationLine({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <div className={strong ? "flex items-baseline justify-between gap-4 border-t pt-4" : "flex items-baseline justify-between gap-4"}>
      <dt className={strong ? "font-medium" : "text-muted-foreground"}>
        {label}
        {note ? <span className="block text-xs">{note}</span> : null}
      </dt>
      <dd className={strong ? "shrink-0 font-tabular text-xl font-semibold" : "shrink-0 font-tabular"}>{value}</dd>
    </div>
  );
}

// Finances analytics for project payments and member payouts. Payments and Payouts hold the underlying records.
export default function TeamFinances({ teamSlug }: { teamSlug: string }) {
  const quiet = { retry: false, meta: { silent: true } } as const;
  const payments = useQuery({ ...trpc.money.payments.queryOptions({ teamSlug }), ...quiet });
  const payouts = useQuery({ ...trpc.payouts.list.queryOptions({ teamSlug }), ...quiet });
  const cases = useQuery({ ...trpc.money.cases.queryOptions({ teamSlug }), ...quiet });
  const [range, setRange] = useState<AnalyticsRange>("30d");
  const [selectedCurrency, setSelectedCurrency] = useState<string>("");
  const [now] = useState(() => new Date());

  const currencies = useMemo(() => {
    const values = new Set<string>();
    for (const payment of payments.data ?? []) values.add(payment.currency);
    for (const payout of payouts.data?.payouts ?? []) values.add(payout.currency);
    return [...values];
  }, [payments.data, payouts.data]);
  const currency = selectedCurrency && currencies.includes(selectedCurrency) ? selectedCurrency : (currencies[0] ?? "USD");
  const rangeMeta = RANGES.find((item) => item.value === range) ?? RANGES[1]!;

  const analytics = useMemo(
    () => collectionAnalytics({ payments: payments.data ?? [], payouts: payouts.data?.payouts ?? [], currency, range, now }),
    [payments.data, payouts.data, currency, range, now],
  );
  const snapshot = useMemo(
    () => financeSummary(payments.data ?? [], payouts.data?.payouts ?? [], cases.data ?? []).find((entry) => entry.currency === currency),
    [payments.data, payouts.data, cases.data, currency],
  );

  if (payments.isPending || payouts.isPending || cases.isPending) return <Loader />;
  if (payments.isError) {
    return (
      <ListPage>
        <h1 className="font-heading text-3xl">Finances</h1>
        <p className="text-sm text-muted-foreground">
          {payments.error.data?.code === "FORBIDDEN" ? "You don’t have access to the team’s finances. A team admin can change your access." : payments.error.message}
        </p>
      </ListPage>
    );
  }

  const money = (minor: number) => formatMinor(minor, currency);
  const current = analytics.current;
  const previous = analytics.previous;
  const difference = previous ? current.grossMinor - previous.grossMinor : null;
  const growthNote = !previous
    ? "All dated activity; no prior-period comparison"
    : previous.grossMinor === 0
      ? current.grossMinor > 0
        ? `No collections in the ${rangeMeta.previousLabel}`
        : `No collections in either period`
      : `${difference !== null && difference >= 0 ? "+" : "−"}${money(Math.abs(difference ?? 0))} (${growth(analytics.growthPercent)}) vs ${rangeMeta.previousLabel}`;

  const categories = analytics.buckets.map((bucket) => bucketLabel(bucket.start, range));
  const series: LineChartSeries[] = [
    { id: "collected", name: "Collected", color: "var(--brand)", values: analytics.buckets.map((bucket) => bucket.collectedMinor / 100) },
    ...(previous ? [{ id: "previous", name: "Previous period", color: "var(--muted-foreground)", values: analytics.buckets.map((bucket) => bucket.previousMinor / 100) }] : []),
    ...(payouts.isSuccess ? [{ id: "paid-out", name: "Paid to members", color: "var(--foreground)", values: analytics.buckets.map((bucket) => bucket.paidOutMinor / 100) }] : []),
  ];

  return (
    <ListPage>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-heading text-3xl">Finances</h1>
          <p className="text-sm text-muted-foreground">Project-payment collections, PayPal costs and member payouts.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {currencies.length > 1 ? (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Currency</span>
              <select aria-label="Currency" className={`${nativeSelectClass} h-9`} value={currency} onChange={(event) => setSelectedCurrency(event.target.value)}>
                {currencies.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          ) : <p className="text-sm text-muted-foreground">{currency}</p>}
          <div className="max-w-full overflow-x-auto pb-0.5">
            <Tabs value={range} onValueChange={(value) => { if (isRange(value)) setRange(value); }} variant="segment" aria-label="Date range">
              <TabsList aria-label="Date range" className="border">
                {RANGES.map((item) => <TabsTrigger key={item.value} value={item.value} className="whitespace-nowrap">{item.label}</TabsTrigger>)}
              </TabsList>
            </Tabs>
          </div>
        </div>
      </div>

      <p role="status" className="text-sm text-muted-foreground">
        {periodLabel(range, analytics.currentStart, analytics.currentEnd)} · Collections are dated by PayPal capture; payouts by settlement.
      </p>

      {payments.data.length === 0 && (payouts.data?.payouts.length ?? 0) === 0 ? (
        <section className="rounded-[10px] border px-5 py-10 text-center">
          <h2 className="font-heading text-lg">No financial activity yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">Collections and member payouts will appear here as money moves.</p>
        </section>
      ) : (
        <>
          <section aria-label="Key figures" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Collected from project payments" value={money(current.grossMinor)} note={growthNote} href={`/${teamSlug}/payments`} />
            <Kpi label="After PayPal fees and refunds" value={money(current.netMinor)} note={`${percent(current.feeRate)} PayPal fees · ${percent(current.refundRate)} refunded`} href={`/${teamSlug}/payments`} />
            <Kpi label="Paid to members" value={payouts.isSuccess ? money(current.paidOutMinor) : "Unavailable"} note={payouts.isSuccess ? `${current.paidOutCount} settled ${current.paidOutCount === 1 ? "payout" : "payouts"} in this period${analytics.undatedPayouts > 0 ? ` · ${analytics.undatedPayouts} more settled without a date${analytics.undatedPaidOutMinor > 0 ? ` (${money(analytics.undatedPaidOutMinor)})` : ""}, not in the dated total` : ""}` : "Payout records are unavailable"} href={payouts.isSuccess ? `/${teamSlug}/payouts` : undefined} />
            <Kpi label="Payments collected" value={String(current.count)} note={current.averageMinor === null ? "No dated collections in this period" : `${money(Math.round(current.averageMinor))} average payment`} href={`/${teamSlug}/payments`} />
          </section>

          <RecordCard
            title="Collections and member payouts"
            description={previous ? `Current period against the ${rangeMeta.previousLabel}, aligned by day or month.` : "All dated collections and settled payouts."}
            actions={<Link href={`/${teamSlug}/payments`} className="text-sm text-muted-foreground underline underline-offset-4">View payments</Link>}
          >
            <LineChart
              series={series}
              categories={categories}
              variant="line"
              label={`Project-payment collections and member payouts in ${currency}`}
              formatValue={(value) => formatMinor(Math.round(value * 100), currency)}
              formatTick={(value) => formatMinor(Math.round(value * 100), currency)}
            >
              <LineChartPlot height={280} />
              <LineChartTooltip />
              <LineChartLegend />
            </LineChart>
            {analytics.undatedPayments + analytics.undatedPayouts + analytics.unknownPayoutAmounts > 0 ? (
              <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                Excluded from dated totals: {[
                  analytics.undatedPayments ? `${analytics.undatedPayments} captured ${analytics.undatedPayments === 1 ? "payment" : "payments"} without a capture date` : null,
                  analytics.undatedPayouts ? `${analytics.undatedPayouts} settled ${analytics.undatedPayouts === 1 ? "payout" : "payouts"} without a settlement date` : null,
                  analytics.unknownPayoutAmounts ? `${analytics.unknownPayoutAmounts} settled ${analytics.unknownPayoutAmounts === 1 ? "payout" : "payouts"} without a recorded amount received` : null,
                ].filter(Boolean).join(", ")}.
              </p>
            ) : null}
          </RecordCard>

          <div className="grid gap-6 xl:grid-cols-2">
            <RecordCard
              title="Collection reconciliation"
              description="Refunds are the amounts recorded against payments collected in this period; the source data has no separate refund date."
              actions={<Link href={`/${teamSlug}/payments`} className="text-sm text-muted-foreground underline underline-offset-4">Payments</Link>}
            >
              <dl className="grid gap-3 text-sm">
                <ReconciliationLine label="Collected" value={money(current.grossMinor)} />
                <ReconciliationLine label="PayPal fees" value={`−${money(current.feesMinor)}`} note={current.missingFees > 0 ? `${current.missingFees} ${current.missingFees === 1 ? "fee" : "fees"} not reported by PayPal yet` : undefined} />
                <ReconciliationLine label="Refunds on these payments" value={`−${money(current.refundsMinor)}`} />
                <ReconciliationLine label="After fees and refunds" value={money(current.netMinor)} strong />
              </dl>
            </RecordCard>

            <RecordCard title="Payment mix" description="Collections by payment kind in this period.">
              {analytics.byKind.length === 0 ? (
                <p className="text-sm text-muted-foreground">No dated collections in this period.</p>
              ) : (
                <table className="w-full text-sm">
                  <caption className="sr-only">Project-payment collections by kind</caption>
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th scope="col" className="py-2 font-medium">Kind</th>
                      <th scope="col" className="py-2 text-right font-medium">Payments</th>
                      <th scope="col" className="py-2 text-right font-medium">Collected</th>
                      <th scope="col" className="py-2 text-right font-medium">Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {analytics.byKind.map((kind) => (
                      <tr key={kind.kind}>
                        <td className="py-2.5">{Object.entries(PAYMENT_KIND_LABELS).find(([key]) => key === kind.kind)?.[1] ?? kind.kind}</td>
                        <td className="py-2.5 text-right tabular-nums">{kind.count}</td>
                        <td className="py-2.5 text-right tabular-nums">{money(kind.amountMinor)}</td>
                        <td className="py-2.5 text-right tabular-nums">{current.grossMinor > 0 ? percent((kind.amountMinor / current.grossMinor) * 100) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </RecordCard>
          </div>

          <section aria-labelledby="top-projects-heading" className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="top-projects-heading" className="font-heading text-lg">Projects by collections</h2>
              <Link href={`/${teamSlug}/projects`} className="text-sm text-muted-foreground underline underline-offset-4">All projects</Link>
            </div>
            <DataList
              label="Projects by collections"
              rows={analytics.projects}
              columns={[
                { key: "project", header: "Project", sortable: true, sortValue: (project) => project.projectTitle.toLocaleLowerCase(), cell: (project) => <Link href={`/${teamSlug}/projects/${project.projectId}`} className="truncate font-medium underline-offset-4 hover:underline">{project.projectTitle}</Link> },
                { key: "client", header: "Client", width: "220px", cell: (project) => <span className="truncate text-muted-foreground">{project.clientName ?? "No client"}</span> },
                { key: "count", header: "Payments", width: "120px", align: "right", sortable: true, sortValue: (project) => project.count, cell: (project) => <span className="tabular-nums">{project.count}</span> },
                { key: "gross", header: "Collected", width: "150px", align: "right", sortable: true, sortValue: (project) => project.grossMinor, cell: (project) => <span className="whitespace-nowrap tabular-nums">{money(project.grossMinor)}</span> },
                { key: "net", header: "After fees and refunds", width: "190px", align: "right", sortable: true, sortValue: (project) => project.netMinor, cell: (project) => <span className="whitespace-nowrap tabular-nums">{money(project.netMinor)}</span> },
              ]}
              getRowId={(project) => project.projectId}
              searchText={(project) => `${project.projectTitle} ${project.clientName ?? ""}`}
              searchLabel="Search projects"
              defaultSort={{ key: "gross", direction: "desc" }}
              pageSize={5}
              empty={{ title: "No collections in this period", text: "Projects appear here when a dated project payment is captured." }}
              noun={{ one: "project", many: "projects" }}
            />
          </section>

          {snapshot ? (
            <section aria-labelledby="needs-attention-heading" className="space-y-3">
              <h2 id="needs-attention-heading" className="font-heading text-lg">Needs attention now</h2>
              <div className="grid gap-3 md:grid-cols-3">
                <Kpi label="Waiting to be paid" value={money(snapshot.pendingInMinor)} note="All pending project payments" href={`/${teamSlug}/payments`} />
                {payouts.isSuccess ? <Kpi label="Payouts waiting for approval" value={money(snapshot.awaitingApprovalMinor)} note={`${snapshot.awaitingApprovalCount} ${snapshot.awaitingApprovalCount === 1 ? "request" : "requests"} · ${money(snapshot.inFlightMinor)} being sent`} href={`/${teamSlug}/payouts`} /> : null}
                {cases.isSuccess ? <Kpi label="Open disputes" value={String(snapshot.openDisputes)} note={`${money(snapshot.disputedMinor)} disputed`} href={`/${teamSlug}/cases`} /> : null}
              </div>
            </section>
          ) : null}
        </>
      )}
    </ListPage>
  );
}
