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
import { ListPage, PageHeader } from "@/components/page-composition";
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
    forWhom: request.departmentName ?? "Any category",
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
    { key: "kind", header: "Type", width: "128px", sortable: true, sortValue: (r) => r.kind, cell: (r) => <span className="text-muted-foreground">{r.kind === "service" ? "Service request" : "Premade item"}</span> },
    { key: "for", header: "Category / buyer", width: "176px", cell: (r) => <span className="truncate text-muted-foreground">{r.forWhom}</span> },
    { key: "amount", header: "Amount", width: "100px", align: "right", sortable: true, sortValue: (r) => r.amount?.minor ?? -1, cell: (r) => <span className="whitespace-nowrap tabular-nums">{r.amount ? formatMinor(r.amount.minor, r.amount.currency) : "To quote"}</span> },
    { key: "status", header: "Status", width: "176px", sortable: true, sortValue: (r) => r.status, cell: (r) => <Badge tone={STATUS_TONE[r.status]}>{r.statusLabel}</Badge> },
    { key: "date", header: "Received", width: "116px", sortable: true, sortValue: (r) => r.date, cell: (r) => <span className="whitespace-nowrap">{new Date(r.date).toLocaleDateString(undefined, DATE)}</span> },
    { key: "action", header: <span className="sr-only">Action</span>, width: "124px", align: "right", cell: (r) => (r.orderId && r.status === "paid" ? <ResendEmail teamSlug={teamSlug} orderId={r.orderId} /> : null) },
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
        <PageHeader title="Orders unavailable" description={requests.error.message} />
      </ListPage>
    );
  }
  const now = Date.now();
  const rows: Row[] = [
    ...(requests.data ?? []).map((request) => fromRequest(teamSlug, request, now)),
    ...(orders.data ?? []).map(fromItemOrder),
  ];
  const kinds = [
    ...(requests.isSuccess ? [{ value: "service", label: "Service requests" }] : []),
    ...(orders.isSuccess ? [{ value: "item", label: "Premade items" }] : []),
  ];

  return (
    <ListPage>
      <PageHeader title="Orders" description="What clients asked for: service requests to shape and quote, and premade items they bought." />
      <DataList
        label="Orders"
        rows={rows}
        columns={columns(teamSlug)}
        getRowId={(r) => r.id}
        searchText={(r) => `${r.title} ${r.detail} ${r.forWhom}`}
        searchLabel="Search orders"
        views={[
          { key: "all", label: "All" },
          { key: "answer", label: "To answer", match: (r) => r.status === "answer" },
          { key: "review", label: "Needs review", match: (r) => r.status === "review" },
          { key: "paid", label: "Paid", match: (r) => r.status === "paid" },
          { key: "refunded", label: "Refunded", match: (r) => r.status === "refunded" },
        ]}
        filters={kinds.length > 1 ? [{ key: "kind", label: "Type", options: kinds, match: (r: Row, v: string) => r.kind === v }] : []}
        defaultSort={{ key: "date", direction: "desc" }}
        empty={{ title: "No orders yet", text: "Service requests from your seller page and premade items clients buy show here." }}
        noun={{ one: "order", many: "orders" }}
      />
    </ListPage>
  );
}
