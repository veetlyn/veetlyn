// The view shape returned by trpc.paypal.onboardingStatus (Task 4). Declared here so the
// web app does not import packages/api internals.
export type PayPalConnection = {
  state: "not_connected" | "pending" | "connected" | "needs_attention";
  merchantId: string | null;
  actionUrl: string | null;
  paymentsReceivable: boolean | null;
  primaryEmailConfirmed: boolean | null;
};

export type PayPalCardModel = {
  tone: "muted" | "success" | "problem";
  title: string;
  detail: string;
  // connect = run startOnboarding; resume = open the stored PayPal action URL; refresh = re-read PayPal.
  action: "connect" | "resume" | "refresh" | null;
  actionLabel: string;
};

function attentionDetail(connection: PayPalConnection): string {
  const missing: string[] = [];
  if (connection.paymentsReceivable === false) {
    missing.push("PayPal has not cleared the account to receive payments yet");
  }
  if (connection.primaryEmailConfirmed === false) {
    missing.push("the PayPal account email address is not confirmed");
  }
  if (missing.length === 0) return "PayPal is still reviewing the account. Check back later.";
  const sentence = missing.join(" and ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}. Reopen the PayPal setup or check back later.`;
}

export function payPalCardModel(connection: PayPalConnection): PayPalCardModel {
  switch (connection.state) {
    case "connected":
      return {
        tone: "success",
        title: "Connected",
        detail: `Payments are paid out to PayPal account ${connection.merchantId}.`,
        action: null,
        actionLabel: "",
      };
    case "pending":
      return {
        tone: "muted",
        title: "Connection in progress",
        detail: "Finish the PayPal sign-up to start accepting payments.",
        action: connection.actionUrl ? "resume" : "refresh",
        actionLabel: connection.actionUrl ? "Continue PayPal setup" : "Check status",
      };
    case "needs_attention":
      return {
        tone: "problem",
        title: "PayPal needs attention",
        detail: attentionDetail(connection),
        action: connection.actionUrl ? "resume" : "refresh",
        actionLabel: connection.actionUrl ? "Reopen PayPal setup" : "Check status again",
      };
    case "not_connected":
      return {
        tone: "muted",
        title: "Not connected",
        detail: "Connect PayPal to accept payments.",
        action: "connect",
        actionLabel: "Connect PayPal",
      };
  }
}
