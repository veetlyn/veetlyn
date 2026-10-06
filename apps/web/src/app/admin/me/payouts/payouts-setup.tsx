"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import Loader from "@/components/loader";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

export default function PayoutsSetup({ connect, paypalError }: { connect: boolean; paypalError: boolean }) {
  const queryClient = useQueryClient();
  const destination = useQuery(trpc.payoutDestination.get.queryOptions());
  const [linkPending, setLinkPending] = useState(false);
  const [connectAttempted, setConnectAttempted] = useState(false);

  const save = useMutation(
    trpc.payoutDestination.connect.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.payoutDestination.get.queryKey() }),
    }),
  );

  // The return from PayPal lands with ?connect=1 and the account linked; save the destination once.
  useEffect(() => {
    if (!connect || connectAttempted || destination.isPending || destination.data) return;
    setConnectAttempted(true);
    save.mutate();
  }, [connect, connectAttempted, destination.isPending, destination.data, save.mutate]);

  async function connectPayPal() {
    setLinkPending(true);
    const result = await authClient.linkSocial({
      provider: "paypal",
      callbackURL: "/me/payouts?connect=1",
      errorCallbackURL: "/me/payouts?error=1",
    });
    if (result.error) {
      setLinkPending(false);
      toast.error(result.error.message ?? "Could not start PayPal.");
    }
    // On success the client follows the redirect to PayPal, so the button stays disabled.
  }

  if (destination.isPending) return <Loader />;

  return (
    <main className="container mx-auto max-w-lg space-y-6 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Payouts</h1>
      {paypalError ? (
        <p role="alert" className="border border-destructive p-3 text-sm text-destructive">
          PayPal did not confirm the connection. Try again.
        </p>
      ) : null}
      <section aria-labelledby="destination-heading" className="space-y-3 border p-4">
        <h2 id="destination-heading" className="font-medium">
          Your PayPal payout destination
        </h2>
        {destination.data ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              Verified PayPal account{destination.data.paypalEmail ? ` (${destination.data.paypalEmail})` : ""}. Payer
              ID {destination.data.paypalPayerId}.
            </p>
            <p>
              Verified {destination.data.verifiedAt ? new Date(destination.data.verifiedAt).toLocaleString() : "recently"}
              . Teams pay you with this PayPal account.
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Connect your PayPal account once. Payleor stores your PayPal payer ID; teams pay you with it.
            </p>
            {save.isError ? (
              <p role="alert" className="text-sm text-destructive">
                {save.error.message}
              </p>
            ) : null}
            {save.isSuccess ? (
              <p className="text-sm text-emerald-700 dark:text-emerald-400">PayPal destination saved.</p>
            ) : null}
            <Button type="button" variant="outline" onClick={connectPayPal} disabled={linkPending}>
              {linkPending ? "Redirecting to PayPal…" : "Log in with PayPal"}
            </Button>
          </>
        )}
      </section>
    </main>
  );
}
