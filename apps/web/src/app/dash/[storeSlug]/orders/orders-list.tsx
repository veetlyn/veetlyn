"use client";

import { Badge } from "@jendal-workspace/ui/components/badge";
import { Button } from "@jendal-workspace/ui/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";

import Loader from "@/components/loader";
import { formatMinor } from "@/lib/money";
import { trpc } from "@/utils/trpc";

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "";
}

// The buyer's confirmation email, with a fresh download link, sent again through the outbox.
function ResendEmail({ teamSlug, orderId }: { teamSlug: string; orderId: string }) {
  const resend = useMutation(trpc.store.resendOrderEmail.mutationOptions());
  return (
    <div className="flex items-center justify-end gap-2">
      {resend.isSuccess ? <p className="text-sm text-muted-foreground">Email sent again.</p> : null}
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

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 md:px-7 md:py-8">
      <h1 className="font-heading text-3xl">Orders</h1>
      {orders.isPending ? (
        <Loader />
      ) : orders.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {orders.error.message}
        </p>
      ) : orders.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No orders yet. They show up here once a buyer pays.</p>
      ) : (
        <ul className="panel divide-y overflow-hidden">
          {orders.data.map((order) => (
            <li key={order.id} className="flex items-center justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0">
                <p className="truncate font-medium">{order.productTitle}</p>
                <p className="truncate text-sm text-muted-foreground">{order.buyerEmail}</p>
              </div>
              <div className="shrink-0 text-right">
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
    </main>
  );
}
