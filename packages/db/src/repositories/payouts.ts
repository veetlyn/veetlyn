import { ledgerAccounts, type PayoutDestinationDraft } from "@jendal-workspace/core";
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";

import type { DbExecutor } from "../executor";
import type { Database } from "../index";
import { account } from "../schema/auth";
import { ledgerBalance } from "../schema/ledger";
import { team } from "../schema/organization";
import { payoutDestination } from "../schema/payouts";

export type PayoutAgeSource = "paypal" | "self";

export type PayoutDestinationRecord = {
  paypalPayerId: string;
  paypalEmail: string | null;
  verifiedAt: Date;
  ageConfirmedAt: Date | null;
  ageSource: PayoutAgeSource | null;
  paypalCountry: string | null;
};

const destinationColumns = {
  paypalPayerId: payoutDestination.paypalPayerId,
  paypalEmail: payoutDestination.paypalEmail,
  verifiedAt: payoutDestination.verifiedAt,
  ageConfirmedAt: payoutDestination.ageConfirmedAt,
  ageSource: payoutDestination.ageSource,
  paypalCountry: payoutDestination.paypalCountry,
};

export async function getPayoutDestination(db: DbExecutor, userId: string): Promise<PayoutDestinationRecord | null> {
  const [row] = await db
    .select(destinationColumns)
    .from(payoutDestination)
    .where(eq(payoutDestination.userId, userId))
    .limit(1);
  return row ?? null;
}

// Callers pass only a draft built from PayPal's userinfo response (payoutDestinationFromUserInfo),
// never user input, so every saved row is a verified destination (services spec §4.2).
// A null age keeps the confirmation already on the row: reconnecting without an age from PayPal does not undo it.
export async function savePayoutDestination(
  db: Database,
  userId: string,
  draft: PayoutDestinationDraft,
  age: { confirmedAt: Date; source: PayoutAgeSource } | null,
): Promise<PayoutDestinationRecord> {
  const values: Omit<typeof payoutDestination.$inferInsert, "userId"> = { ...draft, verifiedAt: new Date() };
  if (age) {
    values.ageConfirmedAt = age.confirmedAt;
    values.ageSource = age.source;
  }
  const [row] = await db
    .insert(payoutDestination)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: payoutDestination.userId, set: values })
    .returning(destinationColumns);
  if (!row) throw new Error("Upsert into payout_destination returned no row");
  return row;
}

// The member's own confirmation; one PayPal already gave is kept as it is. Null when there is no destination.
export async function confirmPayoutDestinationAge(db: DbExecutor, userId: string): Promise<PayoutDestinationRecord | null> {
  await db
    .update(payoutDestination)
    .set({ ageConfirmedAt: new Date(), ageSource: "self" })
    .where(
      and(
        eq(payoutDestination.userId, userId),
        or(isNull(payoutDestination.ageSource), ne(payoutDestination.ageSource, "paypal")),
      ),
    );
  const [row] = await db
    .select(destinationColumns)
    .from(payoutDestination)
    .where(eq(payoutDestination.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function deletePayoutDestination(db: DbExecutor, userId: string): Promise<void> {
  await db.delete(payoutDestination).where(eq(payoutDestination.userId, userId));
}

export type MemberEarningsRow = {
  teamId: string;
  teamName: string;
  teamSlug: string;
  currency: "USD" | "EUR";
  availableMinor: number;
  reservedMinor: number;
  paidOutMinor: number;
  // The team's PayPal country, which with the member's sets PayPal's payout fee.
  teamPayPalCountry: string | null;
};

// The member's earnings per team and currency, from the ledger balances; teams where every balance is zero are left out.
export async function listMemberEarnings(db: DbExecutor, userId: string): Promise<MemberEarningsRow[]> {
  const available = ledgerAccounts.owedAvailable(userId);
  const reserved = ledgerAccounts.owedReserved(userId);
  const paidOut = ledgerAccounts.paidOut(userId);
  const sumFor = (key: string) =>
    sql<number>`coalesce(sum(case when ${ledgerBalance.account} = ${key} then ${ledgerBalance.balanceMinor} end), 0)`.mapWith(
      Number,
    );
  return db
    .select({
      teamId: team.id,
      teamName: team.name,
      teamSlug: team.slug,
      currency: ledgerBalance.currency,
      availableMinor: sumFor(available),
      reservedMinor: sumFor(reserved),
      paidOutMinor: sumFor(paidOut),
      teamPayPalCountry: team.paypalCountry,
    })
    .from(ledgerBalance)
    .innerJoin(team, eq(team.id, ledgerBalance.teamId))
    .where(and(inArray(ledgerBalance.account, [available, reserved, paidOut]), ne(ledgerBalance.balanceMinor, 0)))
    .groupBy(team.id, team.name, team.slug, team.paypalCountry, ledgerBalance.currency)
    .orderBy(team.name, ledgerBalance.currency);
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
