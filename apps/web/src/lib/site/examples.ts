import {
  depositDue,
  getSellerPlan,
  quoteBreakdown,
  SOLO_MANAGEMENT_FEE_BPS,
  SOLO_TEAM_CUT_BPS,
} from "@jendal-workspace/core";

import { saleFees } from "./fees";

const US = { currency: "USD", senderCountry: "US", receiverCountry: "US" } as const;

// Walk Crew, the example agency: a Team plan, a 15% team cut and a 10% management fee, paying a freelancer in the US.
export const EXAMPLE_TEAM = {
  teamCutBps: 1_500,
  managementFeeBps: 1_000,
  platformFeeBps: getSellerPlan("team").feeBps,
  ...US,
} as const;

const WALK_CREW_QUOTE_MINOR = 64_000;

export const walkCrewDepositMinor = () =>
  depositDue(WALK_CREW_QUOTE_MINOR, EXAMPLE_TEAM.managementFeeBps).totalMinor;

export function agencyExample() {
  const b = quoteBreakdown(EXAMPLE_TEAM, WALK_CREW_QUOTE_MINOR);
  return {
    quoteMinor: b.quoteMinor,
    clientPaysMinor: b.clientPaysMinor,
    memberMinor: b.memberReceivesMinor,
    teamMinor: b.teamKeepsMinor,
    paypalMinor: b.checkoutFeeMinor + b.payoutFeeMinor,
    payleorMinor: b.platformFeeMinor,
  };
}

// Amadou on Solo: a $640 project with a client the network brought, so the 5% network fee applies once.
export function freelancerExample() {
  const quoteMinor = 64_000;
  const b = quoteBreakdown(
    { teamCutBps: SOLO_TEAM_CUT_BPS, managementFeeBps: SOLO_MANAGEMENT_FEE_BPS, platformFeeBps: getSellerPlan("solo").feeBps, ...US },
    quoteMinor,
  );
  const fees = saleFees({ kind: "services", planId: "solo", amountMinor: b.clientPaysMinor, source: "network" });
  return {
    quoteMinor,
    keptMinor: b.teamKeepsMinor - fees.networkMinor,
    // A solo seller pays no member, so PayPal's only fee is the checkout's.
    paypalMinor: b.checkoutFeeMinor,
    payleorMinor: fees.totalMinor,
  };
}

// Maison Lune on Team: a $45 pedicure booked through the network; Inès gets 60% and the salon keeps the rest.
export function studioExample() {
  const priceMinor = 4_500;
  const b = quoteBreakdown(
    { teamCutBps: 4_000, managementFeeBps: 0, platformFeeBps: getSellerPlan("team").feeBps, ...US },
    priceMinor,
  );
  const fees = saleFees({ kind: "services", planId: "team", amountMinor: b.clientPaysMinor, source: "network" });
  return {
    priceMinor,
    staffMinor: b.memberReceivesMinor,
    salonMinor: b.teamKeepsMinor - fees.networkMinor,
    paypalMinor: b.checkoutFeeMinor + b.payoutFeeMinor,
    payleorMinor: fees.totalMinor,
  };
}

export function usd(minor: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(minor / 100);
}

export const usdCents = (minor: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(minor / 100);
