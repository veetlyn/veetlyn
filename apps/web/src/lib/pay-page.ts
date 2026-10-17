export type PaymentKind = "deposit" | "top_up" | "balance";
export type PaymentStatus = "pending" | "captured" | "failed" | "cancelled" | "refunded";
export type CaptureOutcome = "captured" | "pending" | "declined";

export type PayPageInput = {
  kind: PaymentKind;
  status: PaymentStatus;
  // A capture PayPal has not finished (payGet: pending with a capture id).
  processing: boolean;
  // The server has PayPal configured and the team has connected its account.
  paypalReady: boolean;
};

export type PayPageState =
  | { view: "pay" }
  | { view: "paid"; message: string }
  | { view: "processing"; message: string }
  | { view: "closed"; message: string };

export function payPageState(input: PayPageInput): PayPageState {
  if (input.status === "captured") return { view: "paid", message: "Paid. Thank you." };
  if (input.status === "cancelled") return { view: "closed", message: "This payment was cancelled." };
  if (input.status === "refunded") return { view: "closed", message: "This payment was refunded." };
  if (input.processing) {
    return { view: "processing", message: "PayPal is still processing this payment. This page updates on its own." };
  }
  if (!input.paypalReady) {
    return { view: "closed", message: "This team cannot take PayPal payments yet. Ask them to connect PayPal." };
  }
  return { view: "pay" };
}

export function paymentKindLabel(kind: PaymentKind): string {
  switch (kind) {
    case "deposit":
      return "Deposit";
    case "top_up":
      return "Top-up";
    case "balance":
      return "Balance";
  }
}

// Null when the page's own state says enough (paid, or processing).
export function captureOutcomeProblem(outcome: CaptureOutcome): string | null {
  return outcome === "declined" ? "PayPal declined this payment. Try again or choose another way to pay." : null;
}

export function sdkEnvironment(environment: "sandbox" | "live"): "sandbox" | "production" {
  return environment === "live" ? "production" : "sandbox";
}

// The pay page links back only to the client page the visitor came from on this site; it never makes a client
// link of its own, since a pay link may be forwarded to someone who is not the client.
export function clientPageReferrer(referrer: string, origin: string): string | null {
  if (!referrer) return null;
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return null;
  }
  if (url.origin !== origin || !url.pathname.startsWith("/c/")) return null;
  return url.pathname;
}
