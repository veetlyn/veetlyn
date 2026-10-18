"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { Checkbox } from "@jendal-workspace/ui/components/checkbox";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import Loader from "@/components/loader";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

import { EarningsSection } from "./earnings-section";
import { PayoutHistory } from "./payout-history";

export default function PayoutsSetup({
  connect,
  confirmAdult,
  paypalProblem,
}: {
  connect: boolean;
  confirmAdult: boolean;
  paypalProblem: string | null;
}) {
  const queryClient = useQueryClient();
  const destination = useQuery(trpc.payoutDestination.get.queryOptions());
  const [linkPending, setLinkPending] = useState(false);
  const [connectAttempted, setConnectAttempted] = useState(false);
  const [adultBeforeConnect, setAdultBeforeConnect] = useState(false);
  const [adultConfirmation, setAdultConfirmation] = useState(false);

  const invalidateDestination = () => queryClient.invalidateQueries({ queryKey: trpc.payoutDestination.get.queryKey() });
  const save = useMutation(trpc.payoutDestination.connect.mutationOptions({ onSuccess: invalidateDestination }));
  const confirmAge = useMutation(trpc.payoutDestination.confirmAdult.mutationOptions({ onSuccess: invalidateDestination }));

  // The return from PayPal lands with ?connect=1 (and ?adult=1 when the box was ticked) and the account linked;
  // save the destination once.
  useEffect(() => {
    if (!connect || connectAttempted || destination.isPending || destination.data) return;
    setConnectAttempted(true);
    save.mutate({ confirmAdult });
  }, [connect, confirmAdult, connectAttempted, destination.isPending, destination.data, save.mutate]);

  async function connectPayPal() {
    setLinkPending(true);
    const result = await authClient.linkSocial({
      provider: "paypal",
      callbackURL: adultBeforeConnect ? "/me/payouts?connect=1&adult=1" : "/me/payouts?connect=1",
      errorCallbackURL: "/me/payouts?error=1",
    });
    if (result.error) {
      setLinkPending(false);
      toast.error(result.error.message ?? "Could not start PayPal.");
    }
    // On success the client follows the redirect to PayPal, so the button stays disabled.
  }

  if (destination.isPending) return <Loader />;

  const requestBlockedReason = !destination.data
    ? "Connect your PayPal account above to request a payout."
    : !destination.data.ageConfirmed
      ? "Confirm you are 18 or older above to request a payout."
      : null;

  return (
    <main className="container mx-auto max-w-2xl space-y-6 px-4 py-10">
      <h1 className="font-[family-name:var(--font-display)] text-3xl">Payouts</h1>
      {paypalProblem ? (
        <p role="alert" className="border border-destructive p-3 text-sm text-destructive">
          {paypalProblem}
        </p>
      ) : null}
      <section aria-labelledby="destination-heading" className="space-y-3 panel p-4">
        <h2 id="destination-heading" className="font-medium">
          Your PayPal payout destination
        </h2>
        {destination.data ? (
          <div className="space-y-3 text-sm">
            <div className="space-y-2 text-muted-foreground">
              <p>
                Verified PayPal account{destination.data.paypalEmail ? ` (${destination.data.paypalEmail})` : ""}. Payer
                ID {destination.data.paypalPayerId}.
              </p>
              <p>
                Verified{" "}
                {destination.data.verifiedAt ? new Date(destination.data.verifiedAt).toLocaleString() : "recently"}.
                Teams pay you with this PayPal account.
              </p>
            </div>
            {destination.data.ageConfirmed ? (
              <p className="text-muted-foreground">Confirmed 18 or older.</p>
            ) : (
              <div className="space-y-3">
                <p>Payouts need a recipient who is 18 or older. PayPal did not share your age, so confirm it here.</p>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={adultConfirmation}
                    onCheckedChange={(checked) => setAdultConfirmation(checked === true)}
                  />
                  I am 18 or older
                </label>
                {confirmAge.error ? (
                  <p role="alert" className="text-destructive">
                    {confirmAge.error.message}
                  </p>
                ) : null}
                <Button
                  type="button"
                  onClick={() => confirmAge.mutate()}
                  disabled={!adultConfirmation || confirmAge.isPending}
                >
                  {confirmAge.isPending ? "Confirming…" : "Confirm"}
                </Button>
              </div>
            )}
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
              <p className="text-sm font-medium text-brand-text">PayPal destination saved.</p>
            ) : null}
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={adultBeforeConnect}
                onCheckedChange={(checked) => setAdultBeforeConnect(checked === true)}
              />
              I am 18 or older
            </label>
            <Button type="button" variant="outline" onClick={connectPayPal} disabled={linkPending}>
              {linkPending ? "Redirecting to PayPal…" : "Log in with PayPal"}
            </Button>
          </>
        )}
      </section>
      <EarningsSection requestBlockedReason={requestBlockedReason} />
      <PayoutHistory />
    </main>
  );
}
