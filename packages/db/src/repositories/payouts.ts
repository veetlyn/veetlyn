import type { PayoutDestinationDraft } from "@jendal-workspace/core";
import { and, desc, eq } from "drizzle-orm";

import type { Database } from "../index";
import { account } from "../schema/auth";
import { payoutDestination } from "../schema/payouts";

export type PayoutDestinationRecord = {
  paypalPayerId: string;
  paypalEmail: string | null;
  verifiedAt: Date;
};

const destinationColumns = {
  paypalPayerId: payoutDestination.paypalPayerId,
  paypalEmail: payoutDestination.paypalEmail,
  verifiedAt: payoutDestination.verifiedAt,
};

export async function getPayoutDestination(db: Database, userId: string): Promise<PayoutDestinationRecord | null> {
  const [row] = await db
    .select(destinationColumns)
    .from(payoutDestination)
    .where(eq(payoutDestination.userId, userId))
    .limit(1);
  return row ?? null;
}

// Callers pass only a draft built from PayPal's userinfo response (payoutDestinationFromUserInfo),
// never user input, so every saved row is a verified destination (services spec §4.2).
export async function savePayoutDestination(
  db: Database,
  userId: string,
  draft: PayoutDestinationDraft,
): Promise<PayoutDestinationRecord> {
  const values = { ...draft, verifiedAt: new Date() };
  const [row] = await db
    .insert(payoutDestination)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: payoutDestination.userId, set: values })
    .returning(destinationColumns);
  if (!row) throw new Error("Upsert into payout_destination returned no row");
  return row;
}

// "Log in with PayPal" (sign-up, sign-in or linkSocial) writes this Better Auth account row: `id` is
// the row ID getAccessToken takes, `accountId` is PayPal's user_id, not the payer ID (Fact 14).
// A PayPal account belongs to one Payleor user, but one user can link several PayPal accounts; the
// most recently updated row is the one the user just linked or signed in with.
export async function findLinkedPayPalAccount(
  db: Database,
  userId: string,
): Promise<{ id: string; accountId: string } | null> {
  const [row] = await db
    .select({ id: account.id, accountId: account.accountId })
    .from(account)
    .where(and(eq(account.providerId, "paypal"), eq(account.userId, userId)))
    .orderBy(desc(account.updatedAt))
    .limit(1);
  return row ?? null;
}
