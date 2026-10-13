import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { account } from "../schema/auth";
import { ledgerBalance } from "../schema/ledger";
import { createTestDb, hasTestDatabase, seedServicesTeamWithAdmin, seedUser, truncateAll } from "../testing/db";
import { findLinkedPayPalAccount, getPayoutDestination, listMemberEarnings, savePayoutDestination } from "./payouts";

const PAYPAL_USER_ID = "https://www.paypal.com/webapps/auth/identity/user/abc123";

describe.skipIf(!hasTestDatabase)("payouts repository", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("finds the user's linked PayPal account and ignores other providers and users", async () => {
    const userId = await seedUser(db, "Ada");
    const otherId = await seedUser(db, "Bea");
    const rowId = crypto.randomUUID();
    await db.insert(account).values([
      { id: crypto.randomUUID(), accountId: "123456789012345678", providerId: "discord", userId },
      { id: rowId, accountId: PAYPAL_USER_ID, providerId: "paypal", userId },
      { id: crypto.randomUUID(), accountId: "other-paypal", providerId: "paypal", userId: otherId },
    ]);

    await expect(findLinkedPayPalAccount(db, userId)).resolves.toEqual({ id: rowId, accountId: PAYPAL_USER_ID });
    await expect(findLinkedPayPalAccount(db, await seedUser(db, "Cleo"))).resolves.toBeNull();
  });

  it("saves a destination, reads it back and replaces it on the next save", async () => {
    const userId = await seedUser(db, "Ada");

    await expect(getPayoutDestination(db, userId)).resolves.toBeNull();
    await expect(
      savePayoutDestination(db, userId, { paypalPayerId: "G83JXTJ5EHCQ2", paypalEmail: "ada@example.com", paypalCountry: "SN" }, null),
    ).resolves.toEqual({
      paypalPayerId: "G83JXTJ5EHCQ2",
      paypalEmail: "ada@example.com",
      verifiedAt: expect.any(Date),
      ageConfirmedAt: null,
      ageSource: null,
      paypalCountry: "SN",
    });

    await savePayoutDestination(db, userId, { paypalPayerId: "WDJJHEBZ4X2LY", paypalEmail: null, paypalCountry: null }, null);
    await expect(getPayoutDestination(db, userId)).resolves.toMatchObject({
      paypalPayerId: "WDJJHEBZ4X2LY",
      paypalEmail: null,
      paypalCountry: null,
    });
  });

  it("keeps an earlier age confirmation when a later save brings no age", async () => {
    const userId = await seedUser(db, "Ada");
    const confirmedAt = new Date("2026-10-01T12:00:00Z");
    await savePayoutDestination(db, userId, { paypalPayerId: "G83JXTJ5EHCQ2", paypalEmail: null, paypalCountry: null }, {
      confirmedAt,
      source: "paypal",
    });

    await expect(
      savePayoutDestination(db, userId, { paypalPayerId: "WDJJHEBZ4X2LY", paypalEmail: null, paypalCountry: null }, null),
    ).resolves.toMatchObject({ paypalPayerId: "WDJJHEBZ4X2LY", ageConfirmedAt: confirmedAt, ageSource: "paypal" });
  });

  it("lists a member's earnings per team and currency and leaves out teams with only zero balances", async () => {
    const studio = await seedServicesTeamWithAdmin(db, { slug: "studio" });
    const quiet = await seedServicesTeamWithAdmin(db, { slug: "quiet" });
    const userId = await seedUser(db, "Ada");
    const otherId = await seedUser(db, "Bea");
    await db.insert(ledgerBalance).values([
      { teamId: studio.teamId, account: `owed:${userId}:available`, currency: "USD", balanceMinor: 5_000 },
      { teamId: studio.teamId, account: `owed:${userId}:reserved`, currency: "USD", balanceMinor: 1_000 },
      { teamId: studio.teamId, account: `paid_out:${userId}`, currency: "USD", balanceMinor: 0 },
      { teamId: studio.teamId, account: `paid_out:${userId}`, currency: "EUR", balanceMinor: 700 },
      { teamId: studio.teamId, account: `owed:${otherId}:available`, currency: "USD", balanceMinor: 9_000 },
      { teamId: studio.teamId, account: "team_revenue", currency: "USD", balanceMinor: 3_000 },
      { teamId: quiet.teamId, account: `owed:${userId}:available`, currency: "USD", balanceMinor: 0 },
      { teamId: quiet.teamId, account: `paid_out:${userId}`, currency: "USD", balanceMinor: 0 },
    ]);

    await expect(listMemberEarnings(db, userId)).resolves.toEqual([
      {
        teamId: studio.teamId,
        teamName: "studio",
        teamSlug: "studio",
        currency: "EUR",
        availableMinor: 0,
        reservedMinor: 0,
        paidOutMinor: 700,
        teamPayPalCountry: null,
      },
      {
        teamId: studio.teamId,
        teamName: "studio",
        teamSlug: "studio",
        currency: "USD",
        availableMinor: 5_000,
        reservedMinor: 1_000,
        paidOutMinor: 0,
        teamPayPalCountry: null,
      },
    ]);
  });
});
