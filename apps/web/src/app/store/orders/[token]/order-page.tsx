"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";

import { downloadsLeftLabel, grantMessage, orderTokenLooksValid } from "@/lib/checkout";
import { formatMinor } from "@/lib/money";
import { queryClient, trpc } from "@/utils/trpc";

function InvalidLink() {
  return (
    <main className="container mx-auto max-w-xl px-4 py-10">
      <p role="alert" className="text-sm text-destructive">
        This link is not valid. Check the link in your email.
      </p>
    </main>
  );
}

export default function OrderPage({ token, slug }: { token: string; slug: string }) {
  const tokenLooksValid = orderTokenLooksValid(token);
  const order = useQuery({ ...trpc.order.get.queryOptions({ token, slug }), retry: false, meta: { silent: true }, enabled: tokenLooksValid });
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.order.get.queryKey({ token, slug }) });
  const download = useMutation(
    trpc.order.download.mutationOptions({
      onSuccess: ({ url }) => window.location.assign(url),
      onSettled: () => refresh(),
    }),
  );
  const sendNewLink = useMutation(trpc.order.sendNewLink.mutationOptions());

  if (!tokenLooksValid) return <InvalidLink />;
  if (order.isPending) {
    return (
      <main className="container mx-auto max-w-xl px-4 py-10">
        <p role="status" className="text-sm text-muted-foreground">
          Loading your order…
        </p>
      </main>
    );
  }
  if (order.error) {
    if (order.error.data?.code === "NOT_FOUND" || order.error.data?.code === "BAD_REQUEST") return <InvalidLink />;
    return (
      <main className="container mx-auto max-w-xl px-4 py-10">
        <p role="alert" className="text-sm text-destructive">
          {order.error.message}
        </p>
      </main>
    );
  }

  const { order: details, team, grant } = order.data;
  const canDownload = grant.state === "usable" && details.status === "paid";
  const message = grantMessage(grant.state, details.status);

  return (
    <main className="container mx-auto max-w-xl space-y-8 px-4 py-10">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Order from {team.name}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{details.productTitle}</h1>
        <p className="text-lg font-medium">{formatMinor(details.amountMinor, details.currency)}</p>
        {details.paidAt ? (
          <p className="text-sm text-muted-foreground">Paid {new Date(details.paidAt).toLocaleDateString()}</p>
        ) : null}
      </div>
      {canDownload ? (
        <div className="space-y-2">
          <Button type="button" disabled={download.isPending} onClick={() => download.mutate({ token, slug })}>
            {download.isPending ? "Preparing download…" : "Download"}
          </Button>
          <p className="text-sm text-muted-foreground">
            {downloadsLeftLabel(grant.downloadsLeft)} · link works until {new Date(grant.expiresAt).toLocaleDateString()}
          </p>
          <p role="alert" className="text-sm text-destructive">
            {download.error?.message}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p>{message}</p>
          {details.status === "refunded" || grant.state === "revoked" ? null : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={sendNewLink.isPending || sendNewLink.isSuccess}
                onClick={() => sendNewLink.mutate({ token, slug })}
              >
                {sendNewLink.isPending ? "Sending…" : "Email me a new link"}
              </Button>
              <p role="status" className="text-sm text-muted-foreground">
                {sendNewLink.data ? `We sent a new link to ${sendNewLink.data.sentTo}.` : null}
              </p>
              <p role="alert" className="text-sm text-destructive">
                {sendNewLink.error?.message}
              </p>
            </>
          )}
        </div>
      )}
    </main>
  );
}
