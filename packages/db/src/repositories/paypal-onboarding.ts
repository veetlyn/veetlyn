import { eq } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import type { Database } from "../index";
import { team } from "../schema/organization";
import {
  paypalOnboarding,
  type PayPalOnboardingStatus,
  type StoredOAuthIntegration,
} from "../schema/paypal";

export type PayPalOnboardingRow = typeof paypalOnboarding.$inferSelect;

export async function findPayPalOnboarding(db: Database, teamId: string): Promise<PayPalOnboardingRow | null> {
  const [row] = await db.select().from(paypalOnboarding).where(eq(paypalOnboarding.teamId, teamId)).limit(1);
  return row ?? null;
}

// A fresh action URL for a new (or restarted) onboarding. Keeps any integration fields:
// a seller who finished once and restarts keeps their merchant id on the row.
export async function savePayPalReferral(
  db: Database,
  input: { teamId: string; trackingId: string; actionUrl: string },
): Promise<PayPalOnboardingRow> {
  const [row] = await db
    .insert(paypalOnboarding)
    .values({ teamId: input.teamId, trackingId: input.trackingId, actionUrl: input.actionUrl, status: "pending" })
    .onConflictDoUpdate({
      target: paypalOnboarding.teamId,
      set: { actionUrl: input.actionUrl, status: "pending", updatedAt: new Date() },
    })
    .returning();
  if (!row) throw new Error("Upsert into paypal_onboarding returned no row");
  return row;
}

export type SavePayPalIntegrationInput = {
  teamId: string;
  merchantId: string;
  status: PayPalOnboardingStatus;
  paymentsReceivable: boolean;
  primaryEmailConfirmed: boolean;
  oauthIntegrations: StoredOAuthIntegration[];
};

// Upsert so a completed PayPal onboarding is recorded even if the referral row is missing.
// The action URL survives: a seller whose account needs attention can reopen the flow.
export async function savePayPalIntegration(
  db: Database,
  input: SavePayPalIntegrationInput,
): Promise<PayPalOnboardingRow> {
  const [row] = await db
    .insert(paypalOnboarding)
    .values({
      teamId: input.teamId,
      trackingId: input.teamId,
      actionUrl: null,
      status: input.status,
      merchantId: input.merchantId,
      paymentsReceivable: input.paymentsReceivable,
      primaryEmailConfirmed: input.primaryEmailConfirmed,
      oauthIntegrations: input.oauthIntegrations,
    })
    .onConflictDoUpdate({
      target: paypalOnboarding.teamId,
      set: {
        status: input.status,
        merchantId: input.merchantId,
        paymentsReceivable: input.paymentsReceivable,
        primaryEmailConfirmed: input.primaryEmailConfirmed,
        oauthIntegrations: input.oauthIntegrations,
        updatedAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new Error("Upsert into paypal_onboarding returned no row");
  return row;
}

// Returns the team's slug so the caller can invalidate the cached store record (Fact 10).
export async function markTeamPayPalMerchant(
  db: Database,
  input: { teamId: string; merchantId: string },
): Promise<{ slug: string } | null> {
  const [row] = await db
    .update(team)
    .set({ paypalMerchantId: input.merchantId })
    .where(eq(team.id, input.teamId))
    .returning({ slug: team.slug });
  return row ?? null;
}

// PayPal reports the connected account's country on its merchant integration.
export async function saveTeamPayPalCountry(db: DbExecutor, input: { teamId: string; country: string }): Promise<void> {
  await db.update(team).set({ paypalCountry: input.country }).where(eq(team.id, input.teamId));
}

export async function getTeamPayPalCountry(db: DbExecutor, teamId: string): Promise<string | null> {
  const [row] = await db.select({ country: team.paypalCountry }).from(team).where(eq(team.id, teamId)).limit(1);
  return row?.country ?? null;
}
