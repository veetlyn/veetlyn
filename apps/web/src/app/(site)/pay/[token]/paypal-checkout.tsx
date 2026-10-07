"use client";

import { loadCoreSdkScript } from "@paypal/paypal-js/sdk-v6";
import { useEffect, useRef, useState } from "react";

import { captureOutcomeProblem, sdkEnvironment } from "@/lib/pay-page";
import { queryClient, trpc, trpcClient } from "@/utils/trpc";

export type PayPalSetup = {
  clientId: string;
  partnerAttributionId: string;
  environment: "sandbox" | "live";
  merchantId: string;
};

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Something went wrong. Try again.";
}

// Services spec §5.4 and R1 facts §5: the v6 SDK with the partner's client ID and the seller's merchant ID.
// The order comes from payStart (the server decides the amount); approval calls payCapture.
export default function PayPalCheckout({ token, currency, paypal }: { token: string; currency: string; paypal: PayPalSetup }) {
  const container = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { clientId, partnerAttributionId, environment, merchantId } = paypal;

  useEffect(() => {
    let stopped = false;
    const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.payment.payGet.queryKey({ token }) });

    async function mount() {
      const sdk = await loadCoreSdkScript({ environment: sdkEnvironment(environment) });
      if (!sdk || stopped) return;
      const instance = await sdk.createInstance({
        clientId,
        merchantId,
        partnerAttributionId,
        components: ["paypal-payments"],
        pageType: "checkout",
      });
      const methods = await instance.findEligibleMethods({ currencyCode: currency });
      if (stopped) return;
      if (!methods.isEligible("paypal")) {
        setProblem("PayPal is not available for this payment.");
        return;
      }
      const session = instance.createPayPalOneTimePaymentSession({
        onApprove: async ({ orderId }) => {
          setBusy(true);
          try {
            const { outcome } = await trpcClient.payment.payCapture.mutate({ token, orderId });
            setProblem(captureOutcomeProblem(outcome));
          } catch (error) {
            setProblem(messageOf(error));
          } finally {
            setBusy(false);
            await refresh();
          }
        },
        onCancel: () => setProblem(null),
        onError: () => setProblem("PayPal could not finish the payment. Try again."),
      });
      const button = document.createElement("paypal-button");
      button.type = "pay";
      button.addEventListener("click", () => {
        setProblem(null);
        // start() must run inside the click so the popup is allowed, and takes the order promise itself.
        const order = trpcClient.payment.payStart.mutate({ token });
        session.start({ presentationMode: "auto" }, order).catch((error: unknown) => {
          setProblem(messageOf(error));
          void refresh();
        });
      });
      container.current?.replaceChildren(button);
    }

    mount().catch(() => {
      if (!stopped) setProblem("PayPal could not load. Reload the page to try again.");
    });
    const mounted = container.current;
    return () => {
      stopped = true;
      mounted?.replaceChildren();
    };
  }, [token, currency, clientId, partnerAttributionId, environment, merchantId]);

  return (
    <div className="space-y-2">
      <div ref={container} aria-busy={busy} className={busy ? "pointer-events-none opacity-50" : undefined} />
      {busy ? <p className="text-sm text-muted-foreground">Confirming your payment…</p> : null}
      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
