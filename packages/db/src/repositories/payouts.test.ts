import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { account } from "../schema/auth";
import { createTestDb, hasTestDatabase, seedUser, truncateAll } from "../testing/db";
import { findLinkedPayPalAccount, getPayoutDestination, savePayoutDestination } from "./payouts";

const PAYPAL_USER_ID = "https://www.paypal.com/webapps/auth/identity/user/abc123";

describe.skipIf(!hasTestDatabase)("payout destination repository", () => {
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
      savePayoutDestination(db, userId, { paypalPayerId: "G83JXTJ5EHCQ2", paypalEmail: "ada@example.com" }),
    ).resolves.toEqual({ paypalPayerId: "G83JXTJ5EHCQ2", paypalEmail: "ada@example.com", verifiedAt: expect.any(Date) });

    await savePayoutDestination(db, userId, { paypalPayerId: "WDJJHEBZ4X2LY", paypalEmail: null });
    await expect(getPayoutDestination(db, userId)).resolves.toMatchObject({
      paypalPayerId: "WDJJHEBZ4X2LY",
      paypalEmail: null,
    });
  });
});
