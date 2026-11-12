"use client";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import { Badge } from "@jendal-workspace/ui/components/badge";
import { Button } from "@jendal-workspace/ui/components/button";
import type { TableColumn } from "@jendal-workspace/ui/components/motion/table";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import Link from "next/link";

import { DataList } from "@/components/data-list";
import Loader from "@/components/loader";
import { ListPage, SummaryStrip } from "@/components/page-composition";
import { formatMinor } from "@/lib/money";
import { trpc } from "@/utils/trpc";

type Outputs = inferRouterOutputs<AppRouter>;
type Request = Outputs["project"]["openRequests"][number];
type ItemOrder = Outputs["order"]["list"][number];

const HOUR_MS = 3_600_000;

// One intake list: a client asks for a service (a request the team answers with a quote) or buys a premade item.
type Row = {
  id: string;
  kind: "service" | "item";
  title: string;
  detail: string;
  forWhom: string;
  amount: { minor: number; currency: string } | null;
  status: "answer" | "paid" | "refunded" | "review";
  statusLabel: string;
  date: number;
  href: string | null;
  orderId: string | null;
};

const STATUS_TONE = { answer: "brand", paid: "good", refunded: "neutral", review: "warn" } as const;

function answerLabel(respondBy: string | Date | null, now: number) {
  if (!respondBy) return "Waiting for an answer";
  const hours = Math.ceil((new Date(respondBy).getTime() - now) / HOUR_MS);
  if (hours <= 0) return "Expiring now";
  return hours === 1 ? "1 hour left to answer" : `${hours} hours left to answer`;
}

function fromRequest(teamSlug: string, request: Request, now: number): Row {
  return {
    id: `request-${request.id}`,
    kind: "service",
    title: request.title,
    detail: request.brief,
    forWhom: request.departmentName ?? "Any department",
    amount: null,
    status: "answer",
    statusLabel: answerLabel(request.respondBy, now),
    date: new Date(request.createdAt).getTime(),
    href: `/${teamSlug}/projects/${request.id}`,
    orderId: null,
  };
}

function fromItemOrder(order: ItemOrder): Row {
  const status = order.reviewReason ? "review" : order.status === "refunded" ? "refunded" : "paid";
  return {
    id: `order-${order.id}`,
    kind: "item",
    title: order.productTitle,
    detail: order.reviewReason ?? "",
    forWhom: order.buyerEmail,
    amount: { minor: order.amountMinor, currency: order.currency },
    status,
    statusLabel: status === "review" ? "Needs review" : status === "refunded" ? "Refunded" : "Paid",
    date: new Date(order.paidAt ?? order.refundedAt ?? Date.now()).getTime(),
    href: null,
    orderId: order.id,
  };
}

function ResendEmail({ teamSlug, orderId }: { teamSlug: string; orderId: string }) {
  const resend = useMutation(trpc.store.resendOrderEmail.mutationOptions());
  if (resend.isSuccess) return <span role="status" className="text-xs text-muted-foreground">{resend.data.sent ? "Email sent again" : "Not sent, try again"}</span>;
  return (
    <Button type="button" variant="ghost" size="sm" disabled={resend.isPending} onClick={() => resend.mutate({ storeSlug: teamSlug, orderId })}>
      {resend.isPending ? "Sending…" : "Resend email"}
    </Button>
  );
}

const DATE: Intl.DateTimeFormatOptions = { dateStyle: "medium" };

function columns(teamSlug: string): TableColumn<Row>[] {
  return [
    { key: "kind", header: "Type", width: "140px", sortable: true, sortValue: (r) => r.kind, cell: (r) => <span className="text-muted-foreground">{r.kind === "service" ? "Service request" : "Premade item"}</span> },
    {
      key: "title",
      header: "Order",
      sortable: true,
      sortValue: (r) => r.title,
      cell: (r) => (
        <span className="grid min-w-0">
          {r.href ? <Link href={r.href} className="truncate font-medium underline-offset-4 hover:underline">{r.title}</Link> : <span className="truncate font-medium">{r.title}</span>}
          {r.detail ? <span className="truncate text-xs text-muted-foreground">{r.detail}</span> : null}
        </span>
      ),
    },
    { key: "for", header: "For", width: "200px", cell: (r) => <span className="truncate text-muted-foreground">{r.forWhom}</span> },
    { key: "amount", header: "Amount", width: "112px", align: "right", sortable: true, sortValue: (r) => r.amount?.minor ?? -1, cell: (r) => <span className="whitespace-nowrap tabular-nums">{r.amount ? formatMinor(r.amount.minor, r.amount.currency) : "To quote"}</span> },
    { key: "status", header: "Status", width: "190px", sortable: true, sortValue: (r) => r.status, cell: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.statusLabel}</Badge> },
    { key: "date", header: "Received", width: "128px", sortable: true, sortValue: (r) => r.date, cell: (r) => <span className="whitespace-nowrap">{new Date(r.date).toLocaleDateString(undefined, DATE)}</span> },
    { key: "action", header: <span className="sr-only">Action</span>, width: "140px", align: "right", cell: (r) => (r.orderId && r.status === "paid" ? <ResendEmail teamSlug={teamSlug} orderId={r.orderId} /> : null) },
  ];
}

export default function TeamOrders({ teamSlug }: { teamSlug: string }) {
  // Each source is authorized by the server; a list this person may not see is simply absent.
  const requests = useQuery({ ...trpc.project.openRequests.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const orders = useQuery({ ...trpc.order.list.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  if (requests.isPending || orders.isPending) return <Loader />;
  if (requests.isError && orders.isError) {
    return (
      <ListPage>
        <h1 className="font-heading text-3xl">Orders unavailable</h1>
        <p className="text-sm text-muted-foreground">{requests.error.message}</p>
      </ListPage>
    );
  }
  const now = Date.now();
  const rows: Row[] = [
    ...(requests.data ?? []).map((request) => fromRequest(teamSlug, request, now)),
    ...(orders.data ?? []).map(fromItemOrder),
  ];
  const waiting = rows.filter((r) => r.status === "answer").length;
  const review = rows.filter((r) => r.status === "review").length;
  const kinds = [
    ...(requests.isSuccess ? [{ value: "service", label: "Service requests" }] : []),
    ...(orders.isSuccess ? [{ value: "item", label: "Premade items" }] : []),
  ];

  return (
    <ListPage>
      <div className="space-y-1">
        <h1 className="font-heading text-3xl">Orders</h1>
        <p className="text-sm text-muted-foreground">What clients asked for: service requests to shape and quote, and premade items they bought.</p>
      </div>
      {rows.length > 0 ? (
        <SummaryStrip label="Needs attention">
          <p className="text-sm"><span className="font-medium">{waiting} {waiting === 1 ? "request" : "requests"}</span> <span className="text-muted-foreground">waiting for an answer</span></p>
          <p className="text-sm text-muted-foreground">{review} {review === 1 ? "order needs" : "orders need"} review</p>
        </SummaryStrip>
      ) : null}
      <DataList
        label="Orders"
        rows={rows}
        columns={columns(teamSlug)}
        getRowId={(r) => r.id}
        searchText={(r) => `${r.title} ${r.detail} ${r.forWhom}`}
        searchLabel="Search orders"
        filters={[
          ...(kinds.length > 1 ? [{ key: "kind", label: "Types", options: kinds, match: (r: Row, v: string) => r.kind === v }] : []),
          {
            key: "status",
            label: "Statuses",
            options: [
              { value: "answer", label: "Waiting for an answer" },
              { value: "paid", label: "Paid" },
              { value: "refunded", label: "Refunded" },
              { value: "review", label: "Needs review" },
            ],
            match: (r: Row, v: string) => r.status === v,
          },
        ]}
        defaultSort={{ key: "date", direction: "desc" }}
        empty={{ title: "No orders yet", text: "Service requests from your seller page and premade items clients buy show here." }}
        noun={{ one: "order", many: "orders" }}
      />
    </ListPage>
  );
}
