import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { ledgerBalance } from "../schema/ledger";
import { createTestDb, hasTestDatabase, seedServicesTeamWithAdmin, seedUser, truncateAll } from "../testing/db";
import { insertPayoutRequest, updatePayoutRequest } from "./payout-requests";
import { listMemberEarnings } from "./payouts";

describe.skipIf(!hasTestDatabase)("payout requests repository", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("allows one open request per member and team, and a new one once the first is rejected", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const userId = await seedUser(db, "Ada");
    const draft = { teamId, userId, currency: "USD" as const, amountMinor: 2_500, receiverPayerId: "G83JXTJ5EHCQ2" };

    const first = await insertPayoutRequest(db, { ...draft, id: crypto.randomUUID() });
    expect(first?.status).toBe("requested");
    await expect(insertPayoutRequest(db, { ...draft, id: crypto.randomUUID() })).resolves.toBeNull();

    await updatePayoutRequest(db, first?.id ?? "", { status: "rejected" });
    await expect(insertPayoutRequest(db, { ...draft, id: crypto.randomUUID() })).resolves.toMatchObject({
      status: "requested",
    });
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
