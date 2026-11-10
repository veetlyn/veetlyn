import { defineMachine } from "../state-machines/machine";

export const PAYPAL_ONBOARDING_STATUSES = ["pending", "connected", "needs_attention"] as const;
export type PayPalOnboardingStatus = (typeof PAYPAL_ONBOARDING_STATUSES)[number];

// The stored copy of PayPal's own answer about a seller's account, not a lifecycle the platform drives: each refresh
// mirrors what PayPal says now, so a connected account can need attention again. The team's merchant id, not this
// status, decides whether the seller is connected.
export const paypalOnboardingMachine = defineMachine({
  name: "paypal_onboarding",
  states: PAYPAL_ONBOARDING_STATUSES,
  initial: "pending",
  transitions: {
    start_referral: { from: ["pending", "connected", "needs_attention"], to: "pending" },
    confirm_connected: { from: ["pending", "connected", "needs_attention"], to: "connected" },
    flag_needs_attention: { from: ["pending", "connected", "needs_attention"], to: "needs_attention" },
  },
});
