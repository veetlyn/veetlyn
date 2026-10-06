import type { StoreRecord } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import {
  findPayPalOnboarding,
  markTeamPayPalMerchant,
  type PayPalOnboardingRow,
  savePayPalIntegration,
  savePayPalReferral,
} from "@jendal-workspace/db/repositories/paypal-onboarding";
import { actionUrlFromLinks, type PayPalClient } from "@jendal-workspace/paypal";
import { TRPCError } from "@trpc/server";

// Assembled by the router (tRPC) and by the return route (Hono) from Context["paypal"] plus the db.
export type PayPalOnboardingDeps = {
  db: Database;
  client: PayPalClient;
  partnerId: string;
  returnUrl: string;
  onTeamMerchantChanged?: (team: { id: string; slug: string }) => void | Promise<void>;
};

export type PayPalOnboardingState = "not_connected" | "pending" | "connected" | "needs_attention";

export type PayPalOnboardingView = {
  state: PayPalOnboardingState;
  merchantId: string | null;
  actionUrl: string | null;
  paymentsReceivable: boolean | null;
  primaryEmailConfirmed: boolean | null;
};

export function viewFor(team: StoreRecord, row: PayPalOnboardingRow | null): PayPalOnboardingView {
  // team.paypal_merchant_id is the source of truth for "connected"; only written once
  // PayPal confirmed payments_receivable and primary_email_confirmed.
  if (team.paypalMerchantId) {
    return {
      state: "connected",
      merchantId: team.paypalMerchantId,
      actionUrl: null,
      paymentsReceivable: row?.paymentsReceivable ?? true,
      primaryEmailConfirmed: row?.primaryEmailConfirmed ?? true,
    };
  }
  if (!row) {
    return {
      state: "not_connected",
      merchantId: null,
      actionUrl: null,
      paymentsReceivable: null,
      primaryEmailConfirmed: null,
    };
  }
  const stored = {
    merchantId: row.merchantId,
    actionUrl: row.actionUrl,
    paymentsReceivable: row.paymentsReceivable,
    primaryEmailConfirmed: row.primaryEmailConfirmed,
  };
  return row.status === "pending" ? { state: "pending", ...stored } : { state: "needs_attention", ...stored };
}

// PayPal caps tracking_id and return_url at 127 characters (Fact 2).
const PAYPAL_URL_MAX_LENGTH = 127;

export async function startPayPalOnboarding(
  deps: PayPalOnboardingDeps,
  team: StoreRecord,
): Promise<{ actionUrl: string }> {
  if (team.paypalMerchantId) {
    throw new TRPCError({ code: "CONFLICT", message: "This team already has a PayPal account connected." });
  }
  if (deps.returnUrl.length > PAYPAL_URL_MAX_LENGTH) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The PayPal return URL is longer than 127 characters." });
  }
  const referral = await deps.client.partnerReferrals.create({
    trackingId: team.id,
    returnUrl: deps.returnUrl,
    // A fresh suffix per attempt: a used action_url cannot be reopened, so every start mints a new link (Fact 6).
    requestId: `partner-referral:${team.id}:${crypto.randomUUID()}`,
  });
  const actionUrl = actionUrlFromLinks(referral.links);
  if (!actionUrl) throw new Error("PayPal's partner referral response has no action_url link.");
  await savePayPalReferral(deps.db, { teamId: team.id, trackingId: team.id, actionUrl });
  return { actionUrl };
}

export async function getPayPalOnboardingView(
  deps: PayPalOnboardingDeps,
  team: StoreRecord,
): Promise<PayPalOnboardingView> {
  return viewFor(team, await findPayPalOnboarding(deps.db, team.id));
}

// Re-reads the integration from PayPal — never trusting return-URL query parameters (Fact 6) —
// stores it, and writes team.paypal_merchant_id once the account can receive payments.
export async function refreshPayPalOnboarding(
  deps: PayPalOnboardingDeps,
  team: StoreRecord,
  hint: { merchantIdInPayPal?: string } = {},
): Promise<PayPalOnboardingView> {
  const lookup = await deps.client.merchantIntegrations.findByTrackingId(deps.partnerId, team.id);
  if (!lookup) {
    // PayPal has no integration for this tracking id yet: the seller has not finished (or declined).
    return viewFor(team, await findPayPalOnboarding(deps.db, team.id));
  }
  if (hint.merchantIdInPayPal && hint.merchantIdInPayPal !== lookup.merchantId) {
    throw new Error(`PayPal's merchant id ${lookup.merchantId} does not match the return parameter.`);
  }
  const status = await deps.client.merchantIntegrations.get(deps.partnerId, lookup.merchantId);
  if (status.trackingId && status.trackingId !== team.id) {
    throw new Error(`PayPal merchant ${lookup.merchantId} belongs to a different tracking id.`);
  }
  const connected = status.paymentsReceivable === true && status.primaryEmailConfirmed === true;
  const row = await savePayPalIntegration(deps.db, {
    teamId: team.id,
    merchantId: lookup.merchantId,
    status: connected ? "connected" : "needs_attention",
    paymentsReceivable: status.paymentsReceivable === true,
    primaryEmailConfirmed: status.primaryEmailConfirmed === true,
    oauthIntegrations: status.oauthIntegrations,
  });
  if (connected && team.paypalMerchantId !== lookup.merchantId) {
    const updated = await markTeamPayPalMerchant(deps.db, { teamId: team.id, merchantId: lookup.merchantId });
    if (updated) await deps.onTeamMerchantChanged?.({ id: team.id, slug: updated.slug });
    return viewFor({ ...team, paypalMerchantId: lookup.merchantId }, row);
  }
  return viewFor(team, row);
}
