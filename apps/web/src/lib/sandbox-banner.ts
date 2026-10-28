export const SANDBOX_NOTICE = "Sandbox: payments use PayPal test accounts. No real money moves.";

export type SandboxSettings = {
  DEPLOY_STAGE?: string;
  PAYPAL_ENVIRONMENT?: string;
  SANDBOX_BUYER_EMAIL?: string;
  SANDBOX_BUYER_PASSWORD?: string;
  SANDBOX_CARD_NUMBER?: string;
  SANDBOX_CARD_EXPIRY?: string;
  SANDBOX_CARD_CVV?: string;
};

export type SandboxBannerContent =
  | { kind: "notice"; text: string }
  | {
      kind: "checkout";
      text: string;
      buyer: { email: string; password: string };
      card: { number: string; expiry: string; cvv: string };
    };

export function sandboxBannerContent(
  variant: "default" | "checkout",
  settings: SandboxSettings,
): SandboxBannerContent | null {
  // Public production pages must not carry the demo banner, even while PayPal remains in sandbox mode.
  if (variant === "default" && settings.DEPLOY_STAGE === "production") return null;
  // The notice says no real money moves; on a live deployment that would be false.
  if (settings.PAYPAL_ENVIRONMENT !== "sandbox") return null;
  const email = settings.SANDBOX_BUYER_EMAIL;
  const password = settings.SANDBOX_BUYER_PASSWORD;
  const number = settings.SANDBOX_CARD_NUMBER;
  const expiry = settings.SANDBOX_CARD_EXPIRY;
  const cvv = settings.SANDBOX_CARD_CVV;
  if (variant === "checkout" && email && password && number && expiry && cvv) {
    return { kind: "checkout", text: SANDBOX_NOTICE, buyer: { email, password }, card: { number, expiry, cvv } };
  }
  return { kind: "notice", text: SANDBOX_NOTICE };
}
