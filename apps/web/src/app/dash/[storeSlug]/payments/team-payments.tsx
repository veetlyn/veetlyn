"use client";

import { Badge } from "@jendal-workspace/ui/components/badge";
import { Button } from "@jendal-workspace/ui/components/button";
import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import type { TableColumn } from "@jendal-workspace/ui/components/motion/table";

import { DataList } from "@/components/data-list";
import Loader from "@/components/loader";
import { ListPage, SummaryStrip } from "@/components/page-composition";
import { formatMinor } from "@/lib/money";
import { PAYMENT_KIND_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/status-labels";
import { trpc } from "@/utils/trpc";

const DATE: Intl.DateTimeFormatOptions = { dateStyle: "medium" };

const TONES = { pending: "neutral", captured: "good", failed: "fail", cancelled: "neutral", refunded: "neutral" } as const;

type Payment = inferRouterOutputs<AppRouter>["money"]["payments"][number];


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
      {payments.isPending ? (
        <Loader />
      ) : payments.isError ? (
        <div role="alert" className="space-y-3 rounded-[10px] border p-5 text-sm">
          <p>{payments.error.data?.code === "FORBIDDEN" ? "You don’t have access to Payments. A team admin can change your access." : payments.error.message}</p>
          {payments.error.data?.code !== "FORBIDDEN" ? <Button type="button" variant="outline" size="sm" onClick={() => void payments.refetch()}>Try again</Button> : null}
        </div>
      ) : (
        <DataList
          label="Payment history: client payments, provider fees and refunds"
          rows={payments.data}
          columns={columns(teamSlug)}
          getRowId={(payment) => payment.id}
          searchText={(payment) => `${payment.projectTitle} ${payment.clientName ?? ""}`}
          searchLabel="Search payments"
          filters={[
            { key: "kind", label: "Kinds", options: Object.entries(PAYMENT_KIND_LABELS).map(([value, label]) => ({ value, label })), match: (payment, value) => payment.kind === value },
            { key: "status", label: "Statuses", options: Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => ({ value, label })), match: (payment, value) => payment.status === value },
          ]}
          defaultSort={{ key: "date", direction: "desc" }}
          empty={{ title: "No client payments yet", text: "Deposits, balances and refunds will appear here as clients pay through PayPal." }}
          noun={{ one: "payment", many: "payments" }}
        />
      )}
    </ListPage>
  );
}
