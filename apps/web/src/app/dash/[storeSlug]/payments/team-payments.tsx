"use client";

import { Badge } from "@jendal-workspace/ui/components/badge";
import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { nativeSelectClass } from "@jendal-workspace/ui/lib/native-select";
import { Table, type TableColumn } from "@jendal-workspace/ui/components/motion/table";
import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import Loader from "@/components/loader";
import { ListPage, SummaryStrip } from "@/components/page-composition";
import { formatMinor } from "@/lib/money";
import { PAYMENT_KIND_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/status-labels";
import { trpc } from "@/utils/trpc";

const DATE: Intl.DateTimeFormatOptions = { dateStyle: "medium" };

const TONES = { pending: "neutral", captured: "good", failed: "fail", cancelled: "neutral", refunded: "neutral" } as const;

type Payment = inferRouterOutputs<AppRouter>["money"]["payments"][number];

const ROW_HEIGHT = 52;
const HEADER_HEIGHT = 41;
const MAX_TABLE_HEIGHT = 560;

const paidOn = (payment: Payment) => new Date(payment.capturedAt ?? payment.createdAt);

function columns(teamSlug: string): TableColumn<Payment>[] {
  return [
    { key: "date", header: "Date", width: "128px", sortable: true, sortValue: (p) => paidOn(p).getTime(), cell: (p) => <span className="whitespace-nowrap">{paidOn(p).toLocaleDateString(undefined, DATE)}</span> },
    { key: "project", header: "Project", sortable: true, sortValue: (p) => p.projectTitle, cell: (p) => <Link href={`/${teamSlug}/projects/${p.projectId}`} className="truncate underline underline-offset-4">{p.projectTitle}</Link> },
    { key: "client", header: "Client", cell: (p) => <span className="truncate">{p.clientName ?? "Client"}</span> },
    { key: "kind", header: "Kind", width: "112px", cell: (p) => PAYMENT_KIND_LABELS[p.kind] },
    { key: "amount", header: "Amount", width: "120px", align: "right", sortable: true, sortValue: (p) => p.amountMinor, cell: (p) => <span className="whitespace-nowrap tabular-nums">{formatMinor(p.amountMinor, p.currency)}</span> },
    { key: "fee", header: "PayPal fee", width: "128px", align: "right", cell: (p) => <span className="whitespace-nowrap tabular-nums">{p.paypalFeeMinor === null ? "Not reported yet" : formatMinor(p.paypalFeeMinor, p.currency)}</span> },
    { key: "refunded", header: "Refunded", width: "112px", align: "right", cell: (p) => <span className="whitespace-nowrap tabular-nums">{p.refundedMinor > 0 ? formatMinor(p.refundedMinor, p.currency) : "None"}</span> },
    { key: "status", header: "Status", width: "128px", sortable: true, sortValue: (p) => p.status, cell: (p) => <Badge tone={TONES[p.status]}>{PAYMENT_STATUS_LABELS[p.status]}</Badge> },
  ];
}

// Money in from clients: every payment on the team's projects, the PayPal fee it cost and what went back.
export default function TeamPayments({ teamSlug }: { teamSlug: string }) {
  const payments = useQuery({ ...trpc.money.payments.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const matching = (payments.data ?? []).filter((payment) =>
    (status === "all" || payment.status === status) && `${payment.projectTitle} ${payment.clientName ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );

  return (
    <ListPage>
      <div className="space-y-1">
        <h1 className="font-heading text-3xl">Payments</h1>
        <p className="text-sm text-muted-foreground">What clients paid on the team's projects, through PayPal.</p>
      </div>
      {payments.isSuccess && payments.data.length > 0 ? (
        <SummaryStrip label="Needs attention">
          <p className="text-sm"><span className="font-medium">{payments.data.filter((payment) => payment.status === "pending").length} payments</span> <span className="text-muted-foreground">waiting to be captured</span></p>
          <p className="text-sm text-muted-foreground">{payments.data.filter((payment) => payment.status === "captured").length} captured</p>
        </SummaryStrip>
      ) : null}
      {payments.isSuccess && payments.data.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="w-full sm:max-w-64"><span className="sr-only">Search payments by project or client</span><Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search payments…" /></label>
          <label><span className="sr-only">Payment status</span><select className={nativeSelectClass} value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All statuses</option>
            {Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        </div>
      ) : null}
      {payments.isPending ? (
        <Loader />
      ) : payments.isError ? (
        <div role="alert" className="space-y-3 rounded-[10px] border p-5 text-sm">
          <p>{payments.error.data?.code === "FORBIDDEN" ? "You don’t have access to Payments. A team admin can change your access." : payments.error.message}</p>
          {payments.error.data?.code !== "FORBIDDEN" ? <Button type="button" variant="outline" size="sm" onClick={() => void payments.refetch()}>Try again</Button> : null}
        </div>
      ) : payments.data.length === 0 ? (
        <section className="rounded-[10px] border px-5 py-10 text-center">
          <h2 className="font-heading text-lg">No client payments yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">Deposits, balances and refunds will appear here as clients pay through PayPal.</p>
        </section>
      ) : matching.length === 0 ? (
        <section className="rounded-[10px] border px-5 py-10 text-center">
          <h2 className="font-heading text-lg">No matching payments</h2>
          <p className="mt-2 text-sm text-muted-foreground">Try another project, client or status.</p>
          <Button type="button" variant="outline" className="mt-4" onClick={() => { setSearch(""); setStatus("all"); }}>Clear filters</Button>
        </section>
      ) : (
        // beUI's data table: sortable by date, project, amount and status; money columns right-aligned.
        <div role="region" aria-label="Payment history: client payments, provider fees and refunds" className="overflow-hidden rounded-[10px]">
          <Table
            data={matching}
            columns={columns(teamSlug)}
            getRowId={(payment) => payment.id}
            defaultSort={{ key: "date", direction: "desc" }}
            rowHeight={ROW_HEIGHT}
            height={Math.min(matching.length * ROW_HEIGHT + HEADER_HEIGHT, MAX_TABLE_HEIGHT)}
            className="rounded-[10px]"
          />
        </div>
      )}
    </ListPage>
  );
}
