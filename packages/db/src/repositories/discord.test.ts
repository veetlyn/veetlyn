import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { account } from "../schema/auth";
import { discordLinkCode } from "../schema/services-teams";
import { createTestDb, hasTestDatabase, seedOrganization, seedServicesTeam, truncateAll } from "../testing/db";
import {
  consumeDiscordLinkCode,
  createDiscordLinkCode,
  findTeamIdByDiscordGuildId,
  findUserIdByDiscordId,
  setServicesTeamDiscordGuildId,
} from "./discord";

describe.skipIf(!hasTestDatabase)("discord repository", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function seedTeam(slug: string) {
    const { organizationId, userId } = await seedOrganization(db);
    const team = await seedServicesTeam(db, { organizationId, slug });
    return { organizationId, userId, team };
  }

  it("finds the Payleor user behind a Discord account, and only that provider", async () => {
    const { userId } = await seedTeam("acme-studio");
    await db.insert(account).values([
      { id: crypto.randomUUID(), accountId: "123456789012345678", providerId: "discord", userId },
      { id: crypto.randomUUID(), accountId: "PAYER123", providerId: "paypal", userId },
    ]);

    await expect(findUserIdByDiscordId(db, "123456789012345678")).resolves.toBe(userId);
    await expect(findUserIdByDiscordId(db, "PAYER123")).resolves.toBeNull();
  });

  it("creates a link code that can be consumed exactly once within its lifetime", async () => {
    const { team } = await seedTeam("acme-studio");

    const { code } = await createDiscordLinkCode(db, team.id);

    expect(code).toMatch(/^[0-9a-f]{12}$/);
    await expect(consumeDiscordLinkCode(db, code)).resolves.toBe(team.id);
    await expect(consumeDiscordLinkCode(db, code)).resolves.toBeNull();
    await expect(consumeDiscordLinkCode(db, "000000000000")).resolves.toBeNull();
  });

  it("refuses an expired code", async () => {
    const { team } = await seedTeam("acme-studio");
    await db
      .insert(discordLinkCode)
      .values({ teamId: team.id, code: "expiredcode0", expiresAt: new Date(Date.now() - 1) });

    await expect(consumeDiscordLinkCode(db, "expiredcode0")).resolves.toBeNull();
  });

  it("links one guild per team and one team per guild", async () => {
    const first = await seedTeam("first");
    const second = await seedTeam("second");

    await expect(setServicesTeamDiscordGuildId(db, first.team.id, "guild-1")).resolves.toBe("linked");
    await expect(findTeamIdByDiscordGuildId(db, "guild-1")).resolves.toBe(first.team.id);
    await expect(setServicesTeamDiscordGuildId(db, second.team.id, "guild-1")).resolves.toBe("conflict");
    // The same team can move its link to another server.
    await expect(setServicesTeamDiscordGuildId(db, first.team.id, "guild-2")).resolves.toBe("linked");
    await expect(findTeamIdByDiscordGuildId(db, "guild-1")).resolves.toBeNull();
  });

  it("reports a missing settings row instead of linking nothing", async () => {
    const { organizationId } = await seedOrganization(db);
    const team = await seedServicesTeam(db, { organizationId, slug: "acme-studio", withSettings: false });

    await expect(setServicesTeamDiscordGuildId(db, team.id, "guild-1")).resolves.toBe("missing");
  });
});
