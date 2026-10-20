"use client";

import { loadCoreSdkScript, type OneTimePaymentSession } from "@paypal/paypal-js/sdk-v6";
import { useEffect, useRef, useState } from "react";

import { captureOutcomeProblem, sdkEnvironment } from "@/lib/pay-page";
import { queryClient, trpc, trpcClient } from "@/utils/trpc";

export type PayPalSetup = {
  clientId: string;
  partnerAttributionId: string;
  environment: "sandbox" | "live";
  merchantId: string;
};

function messageOf(cause: unknown): string {
  return cause instanceof Error && cause.message ? cause.message : "Something went wrong. Try again.";
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(messageOf(cause));
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
    let session: OneTimePaymentSession | null = null;
    // The SDK reports a refused order through start() and onError with its own wording; the server's message is the useful one.
    let startError: Error | null = null;
    // Covers the popup being open and the capture after it, so repeat clicks and key presses cannot start a second payment.
    let starting = false;
    let capturing = false;
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
      const created = instance.createPayPalOneTimePaymentSession({
        onApprove: async ({ orderId }) => {
          starting = false;
          capturing = true;
          setBusy(true);
          try {
            const { outcome } = await trpcClient.payment.payCapture.mutate({ token, orderId });
            setProblem(captureOutcomeProblem(outcome));
          } catch (error) {
            setProblem(messageOf(error));
          } finally {
            // Refresh first so the button does not come back before the page shows the result.
            await refresh();
            capturing = false;
            setBusy(false);
          }
        },
        onCancel: () => {
          starting = false;
          setProblem(null);
        },
        onError: () => {
          starting = false;
          if (!startError) setProblem("PayPal could not finish the payment. Try again.");
        },
      });
      session = created;
      const button = document.createElement("paypal-button");
      button.type = "pay";
      button.addEventListener("click", () => {
        if (capturing || starting) return;
        starting = true;
        startError = null;
        setProblem(null);
        const order = trpcClient.payment.payStart.mutate({ token });
        // A side branch: the SDK still receives the same promise and sees its rejection.
        order.catch((cause: unknown) => {
          starting = false;
          startError = asError(cause);
          setProblem(messageOf(cause));
          void refresh();
        });
        // start() must run inside the click so the popup is allowed, and takes the order promise itself.
        created
          .start({ presentationMode: "auto" }, order)
          .catch((cause: unknown) => {
            if (!startError) setProblem(messageOf(cause));
          })
          .finally(() => {
            if (!capturing) starting = false;
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
      session?.destroy();
      mounted?.replaceChildren();
    };
  }, [token, currency, clientId, partnerAttributionId, environment, merchantId]);

  return (
    <div className="space-y-2">
      <div ref={container} aria-busy={busy} className={busy ? "pointer-events-none opacity-50" : undefined} />
      {busy ? (
        <p role="status" className="text-sm text-muted-foreground">
          Confirming your payment…
        </p>
      ) : null}
      {/* Always mounted so screen readers announce a new problem reliably. */}
      <p role="alert" className="text-sm text-destructive">
        {problem}
      </p>
    </div>
  );
}
