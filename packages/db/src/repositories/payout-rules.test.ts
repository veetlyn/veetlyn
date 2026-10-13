import { presetRules } from "@jendal-workspace/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDb, hasTestDatabase, seedServicesTeamWithAdmin, seedUser, truncateAll } from "../testing/db";
import { getPayoutRules, savePayoutRules } from "./payout-rules";

describe.skipIf(!hasTestDatabase)("payout rules repository", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("replaces the trusted members on every save", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const [ada, bea, cleo] = [await seedUser(db, "Ada"), await seedUser(db, "Bea"), await seedUser(db, "Cleo")];
    const rules = { ...presetRules("rules"), preset: "custom" as const, holdDays: 7, payCompletedProjectsSince: null };

    await savePayoutRules(db, teamId, { ...rules, trustedMemberIds: [ada, bea] });
    await savePayoutRules(db, teamId, { ...rules, trustedMemberIds: [cleo] });

    await expect(getPayoutRules(db, teamId)).resolves.toEqual({ ...rules, trustedMemberIds: [cleo] });
  });
});
