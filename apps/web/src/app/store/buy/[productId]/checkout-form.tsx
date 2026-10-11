"use client";

import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { loadCoreSdkScript, type OneTimePaymentSession } from "@paypal/paypal-js/sdk-v6";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { checkoutEmailProblem } from "@/lib/checkout";
import { sdkEnvironment } from "@/lib/pay-page";
import { trpc, trpcClient } from "@/utils/trpc";

type PayPalSetup = {
  clientId: string;
  partnerAttributionId: string;
  environment: "sandbox" | "live";
  merchantId: string;
};

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Something went wrong. Try again.";
}

export default function CheckoutForm({ slug, productId, currency }: { slug: string; productId: string; currency: string }) {
  const checkout = useQuery({ ...trpc.checkout.get.queryOptions({ slug, productId }), retry: false });
  const [email, setEmail] = useState("");
  const [emailProblem, setEmailProblem] = useState<string | null>(null);
  const emailRef = useRef("");
  const emailInput = useRef<HTMLInputElement>(null);

  if (checkout.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading checkout…
      </p>
    );
  }
  if (checkout.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {checkout.error.message}
      </p>
    );
  }
  const { paypal, team } = checkout.data;
  if (paypal === null) {
    return (
      <p role="alert" className="text-sm text-destructive">
        This seller cannot take payments yet.
      </p>
    );
  }

  // Runs on a PayPal button click, outside React's event system, so it reads the field through refs.
  function emailIsReady(): boolean {
    const problem = checkoutEmailProblem(emailRef.current);
    setEmailProblem(problem);
    if (problem) emailInput.current?.focus();
    return problem === null;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="checkout-email">Your email</Label>
        <Input
          ref={emailInput}
          id="checkout-email"
          type="email"
          autoComplete="email"
          value={email}
          aria-invalid={emailProblem !== null}
          aria-describedby="checkout-email-hint checkout-email-problem"
          onChange={(event) => {
            setEmail(event.target.value);
            emailRef.current = event.target.value;
            setEmailProblem(null);
          }}
          required
        />
        <p id="checkout-email-hint" className="text-sm text-muted-foreground">
          We'll send your download link here.
        </p>
        <p id="checkout-email-problem" role="alert" className="text-sm text-destructive">
          {emailProblem}
        </p>
      </div>
      <PayPalButton
        slug={slug}
        productId={productId}
        currency={currency}
        paypal={paypal}
        emailRef={emailRef}
        emailIsReady={emailIsReady}
      />
      <p className="text-sm text-muted-foreground">Payments go to {team.name} through PayPal.</p>
    </div>
  );
}

function PayPalButton({
  slug,
  productId,
  currency,
  paypal,
  emailRef,
  emailIsReady,
}: {
  slug: string;
  productId: string;
  currency: string;
  paypal: PayPalSetup;
  emailRef: React.RefObject<string>;
  emailIsReady: () => boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The effect must not re-run when the parent re-renders with a new function identity.
  const emailIsReadyRef = useRef(emailIsReady);
  emailIsReadyRef.current = emailIsReady;
  const { clientId, partnerAttributionId, environment, merchantId } = paypal;

  useEffect(() => {
    let stopped = false;
    let session: OneTimePaymentSession | null = null;
    // The SDK reports a refused order through start() and onError with its own wording; the server's message is the useful one.
    let startError: unknown = null;
    // Covers the popup being open and the capture after it, so repeat clicks and key presses cannot start a second payment.
    let starting = false;
    let capturing = false;
    // Each click starts a new order; capture must prove it came from the same browser with that order's secret.
    let secret: string | null = null;

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
          let leaving = false;
          try {
            if (secret === null) throw new Error("This checkout is not valid.");
            const result = await trpcClient.checkout.capture.mutate({ orderId, secret });
            if (result.outcome === "captured") {
              leaving = true;
              window.location.assign(result.orderPath);
              return;
            }
            if (result.outcome === "pending") {
              setNotice("PayPal is still processing your payment. We'll email your download link as soon as it clears.");
            } else {
              setProblem("PayPal declined this payment. Try again or choose another way to pay.");
            }
          } catch (error) {
            setProblem(messageOf(error));
          } finally {
            // Keep the button disabled while the browser navigates to the order page.
            if (!leaving) {
              capturing = false;
              setBusy(false);
            }
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
        setProblem(null);
        setNotice(null);
        if (!emailIsReadyRef.current()) return;
        starting = true;
        startError = null;
        secret = null;
        const started = trpcClient.checkout.start.mutate({ slug, productId, email: emailRef.current.trim() });
        started.then(
          (result) => {
            secret = result.secret;
          },
          (error: unknown) => {
            starting = false;
            startError = error;
            setProblem(messageOf(error));
          },
        );
        // start() must run inside the click so the popup is allowed, and takes the order promise itself.
        created
          .start(
            { presentationMode: "auto" },
            started.then((result) => ({ orderId: result.orderId })),
          )
          .catch((error: unknown) => {
            if (!startError) setProblem(messageOf(error));
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
  }, [slug, productId, currency, clientId, partnerAttributionId, environment, merchantId, emailRef]);

  return (
    <div className="space-y-2">
      <div ref={container} aria-busy={busy} className={busy ? "pointer-events-none opacity-50" : undefined} />
      <p role="status" className="text-sm text-muted-foreground">
        {busy ? "Confirming your payment…" : notice}
      </p>
      {/* Always mounted so screen readers announce a new problem reliably. */}
      <p role="alert" className="text-sm text-destructive">
        {problem}
      </p>
    </div>
  );
}
