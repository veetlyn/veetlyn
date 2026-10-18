"use client";

import { useQuery } from "@tanstack/react-query";

import Loader from "@/components/loader";
import { formatMinor } from "@/lib/money";
import { trpc } from "@/utils/trpc";

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "";
}

export default function OrdersList({ teamSlug }: { teamSlug: string }) {
  const orders = useQuery({ ...trpc.order.list.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 md:px-7 md:py-8">
      <div className="space-y-1">
        <h1 className="font-[family-name:var(--font-display)] text-3xl">Orders</h1>
      </div>
      {orders.isPending ? (
        <Loader />
      ) : orders.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {orders.error.message}
        </p>
      ) : orders.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No orders yet. They show up here once a buyer pays.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {orders.data.map((order) => (
            <li key={order.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{order.productTitle}</p>
                <p className="truncate text-sm text-muted-foreground">{order.buyerEmail}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-medium">{formatMinor(order.amountMinor, order.currency)}</p>
                <div className="flex items-center justify-end gap-2">
                  {order.status === "refunded" ? (
                    <span className="inline-block rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      Refunded {formatDate(order.refundedAt)}
                    </span>
                  ) : (
                    <p className="text-sm text-muted-foreground">Paid {formatDate(order.paidAt)}</p>
                  )}
                  {order.reviewReason ? (
                    <span className="inline-block rounded-md bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                      Needs review
                    </span>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
