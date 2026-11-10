"use client";

import { Badge } from "@jendal-workspace/ui/components/badge";
import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { nativeSelectClass } from "@jendal-workspace/ui/lib/native-select";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import Loader from "@/components/loader";
import { ListPage, SummaryStrip } from "@/components/page-composition";
import { formatMinor } from "@/lib/money";
import { trpc } from "@/utils/trpc";

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "Date not available";
}

// The buyer's confirmation email, with a fresh download link, sent again through the outbox.
function ResendEmail({ teamSlug, orderId }: { teamSlug: string; orderId: string }) {
  const resend = useMutation(trpc.store.resendOrderEmail.mutationOptions());
  return (
    <div className="mt-3 grid justify-items-start gap-2 sm:justify-items-end">
      {resend.isSuccess && resend.data.sent ? <p role="status" className="text-sm text-muted-foreground">Email sent again.</p> : null}
      {resend.isSuccess && !resend.data.sent ? <p role="alert" className="max-w-xs text-sm text-destructive">The email wasn’t sent. Try again.</p> : null}
      {resend.error ? <p role="alert" className="text-sm text-destructive">{resend.error.message}</p> : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={resend.isPending}
        onClick={() => resend.mutate({ storeSlug: teamSlug, orderId })}
      >
        {resend.isPending ? "Sending…" : "Resend confirmation email"}
      </Button>
    </div>
  );
}

export default function OrdersList({ teamSlug }: { teamSlug: string }) {
  const orders = useQuery({ ...trpc.order.list.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const matching = (orders.data ?? []).filter((order) =>
    (status === "all" || (status === "review" ? Boolean(order.reviewReason) : order.status === status)) && `${order.productTitle} ${order.buyerEmail}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );

  return (
    <ListPage>
      <header className="space-y-1"><h1 className="font-heading text-3xl">Orders</h1><p className="text-sm text-muted-foreground">Paid downloads, buyer details and confirmation emails.</p></header>
      {orders.isSuccess && orders.data.length > 0 ? (
        <SummaryStrip label="Needs attention">
          <p className="text-sm"><span className="font-medium">{orders.data.filter((order) => order.reviewReason).length} orders</span> <span className="text-muted-foreground">need review</span></p>
          <p className="text-sm text-muted-foreground">{orders.data.filter((order) => order.status === "paid").length} paid</p>
        </SummaryStrip>
      ) : null}
      {orders.isSuccess && orders.data.length > 0 ? <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="w-full sm:max-w-72"><span className="sr-only">Search orders by product or buyer</span><Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search orders…" /></label>
        <label><span className="sr-only">Order status</span><select value={status} onChange={(event) => setStatus(event.target.value)} className={nativeSelectClass}><option value="all">All orders</option><option value="paid">Paid</option><option value="refunded">Refunded</option><option value="review">Needs review</option></select></label>
      </div> : null}
      {orders.isPending ? (
        <Loader />
      ) : orders.isError ? (
        <div role="alert" className="space-y-3 rounded-[10px] border p-5 text-sm"><p>{orders.error.message}</p>{orders.error.data?.code !== "FORBIDDEN" ? <Button type="button" variant="outline" size="sm" onClick={() => void orders.refetch()}>Try again</Button> : null}</div>
      ) : orders.data.length === 0 ? (
        <section className="rounded-[10px] border px-5 py-10 text-center"><h2 className="font-heading text-lg">No orders yet</h2><p className="mt-2 text-sm text-muted-foreground">Orders appear here once a buyer pays for a download.</p></section>
      ) : matching.length === 0 ? (
        <section className="rounded-[10px] border px-5 py-10 text-center"><h2 className="font-heading text-lg">No matching orders</h2><p className="mt-2 text-sm text-muted-foreground">Try another product, buyer or status.</p><Button type="button" variant="outline" className="mt-4" onClick={() => { setSearch(""); setStatus("all"); }}>Clear filters</Button></section>
      ) : (
        <ul className="panel divide-y overflow-hidden">
          {matching.map((order) => (
            <li key={order.id} className="flex flex-wrap items-start justify-between gap-4 p-4 sm:flex-nowrap">
              <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                <p className="break-words font-medium">{order.productTitle}</p>
                <p className="mt-1 break-all text-sm text-muted-foreground">{order.buyerEmail}</p>
              </div>
              <div className="min-w-0 text-left sm:shrink-0 sm:text-right">
                <p className="font-tabular text-sm font-medium">{formatMinor(order.amountMinor, order.currency)}</p>
                <div className="flex items-center justify-end gap-2">
                  {order.status === "refunded" ? (
                    <Badge>Refunded {formatDate(order.refundedAt)}</Badge>
                  ) : (
                    <p className="text-sm text-muted-foreground">Paid {formatDate(order.paidAt)}</p>
                  )}
                  {order.reviewReason ? (
                    <Badge tone="warn">Needs review</Badge>
                  ) : null}
                </div>
                {order.status === "paid" ? <ResendEmail teamSlug={teamSlug} orderId={order.id} /> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </ListPage>
  );
}
