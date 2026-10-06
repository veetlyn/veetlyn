import { createDiscordLinkCode, consumeDiscordLinkCode } from "@jendal-workspace/db/repositories/discord";
import {
  addServicesTeamMember,
  getServicesTeamSettings,
} from "@jendal-workspace/db/repositories/services-teams";
import { account } from "@jendal-workspace/db/schema/auth";
import {
  addMember,
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedServicesTeam,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  DEFERRED_EPHEMERAL_RESPONSE,
  editOriginalInteractionResponse,
  handleDiscordInteraction,
} from "./interactions";

const config = { applicationId: "application-1", webBaseUrl: "https://admin.payleor.test" };

function linkInteraction(discordId: string, permissions: string, code: string) {
  return {
    id: "interaction-1",
    token: "token-1",
    type: 2,
    data: {
      name: "payleor",
      options: [{ name: "link", type: 1, options: [{ name: "code", type: 3, value: code }] }],
    },
    guild_id: "guild-1",
    member: { user: { id: discordId }, permissions },
  } satisfies Parameters<typeof handleDiscordInteraction>[2];
}

describe.skipIf(!hasTestDatabase)("handleDiscordInteraction", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function seedTeamAdmin(discordId: string, slug = "acme-studio") {
    const { organizationId, userId } = await seedOrganization(db); // workspace owner → team admin
    const team = await seedServicesTeam(db, { organizationId, slug });
    await db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: discordId,
      providerId: "discord",
      userId,
    });
    return { organizationId, userId, team };
  }

  it("answers a PING with a PONG", async () => {
    const result = await handleDiscordInteraction(config, { db }, { id: "1", token: "t", type: 1 });

    expect(result).toEqual({ kind: "reply", response: { type: 1 } });
  });

  it("answers interactions it does not handle yet politely and ephemerally", async () => {
    const result = await handleDiscordInteraction(config, { db }, {
      id: "1",
      token: "t",
      type: 3,
      data: { name: "button" },
    });

    expect(result).toEqual({
      kind: "reply",
      response: { type: 4, data: { flags: 64, content: "Payleor cannot handle this interaction yet." } },
    });
  });

  it("answers /payouts setup with an ephemeral link to the payout destination page", async () => {
    const result = await handleDiscordInteraction(config, { db }, {
      id: "1",
      token: "t",
      type: 2,
      data: { name: "payouts", options: [{ name: "setup", type: 1 }] },
    });

    expect(result).toEqual({
      kind: "reply",
      response: {
        type: 4,
        data: {
          flags: 64,
          content: "Set up your PayPal payout destination on Payleor: https://admin.payleor.test/me/payouts",
        },
      },
    });
  });

  describe("/payleor link", () => {
    it("defers, then links the server for a team admin with Manage Server, consuming the code once", async () => {
      const { team } = await seedTeamAdmin("discord-admin");
      const { code } = await createDiscordLinkCode(db, team.id);

      const result = await handleDiscordInteraction(
        config,
        { db },
        linkInteraction("discord-admin", String(1 << 5), code),
      );

      expect(result.kind).toBe("deferred");
      if (result.kind !== "deferred") throw new Error("expected a deferred reply");
      await expect(result.followUp).resolves.toContain("now linked to your Payleor team");
      await expect(getServicesTeamSettings(db, team.id)).resolves.toMatchObject({ discordGuildId: "guild-1" });
      // The handler consumed the code, so it cannot be replayed.
      await expect(consumeDiscordLinkCode(db, code)).resolves.toBeNull();
    });

    it("refuses a caller without the Manage Server permission", async () => {
      const { team } = await seedTeamAdmin("discord-admin");
      const { code } = await createDiscordLinkCode(db, team.id);

      const result = await handleDiscordInteraction(config, { db }, linkInteraction("discord-admin", "1", code));

      if (result.kind !== "deferred") throw new Error("expected a deferred reply");
      await expect(result.followUp).resolves.toContain("Manage Server permission");
      await expect(getServicesTeamSettings(db, team.id)).resolves.toMatchObject({ discordGuildId: null });
    });

    it("refuses an invalid code", async () => {
      const result = await handleDiscordInteraction(
        config,
        { db },
        linkInteraction("discord-admin", String(1 << 5), "000000000000"),
      );

      if (result.kind !== "deferred") throw new Error("expected a deferred reply");
      await expect(result.followUp).resolves.toContain("code is not valid");
    });

    it("refuses a Discord account that is not linked to a Payleor user", async () => {
      const { organizationId } = await seedOrganization(db);
      const team = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
      const { code } = await createDiscordLinkCode(db, team.id);

      const result = await handleDiscordInteraction(
        config,
        { db },
        linkInteraction("stranger", String(1 << 5), code),
      );

      if (result.kind !== "deferred") throw new Error("expected a deferred reply");
      await expect(result.followUp).resolves.toContain("link your Discord account to Payleor");
      await expect(getServicesTeamSettings(db, team.id)).resolves.toMatchObject({ discordGuildId: null });
    });

    it("refuses a linked user who is not an admin of the team", async () => {
      const { organizationId } = await seedOrganization(db);
      const team = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
      const freelancer = await addMember(db, { organizationId, role: "member", name: "Bea" });
      await addServicesTeamMember(db, { teamId: team.id, userId: freelancer, role: "freelancer" });
      await db.insert(account).values({
        id: crypto.randomUUID(),
        accountId: "discord-freelancer",
        providerId: "discord",
        userId: freelancer,
      });
      const { code } = await createDiscordLinkCode(db, team.id);

      const result = await handleDiscordInteraction(
        config,
        { db },
        linkInteraction("discord-freelancer", String(1 << 5), code),
      );

      if (result.kind !== "deferred") throw new Error("expected a deferred reply");
      await expect(result.followUp).resolves.toContain("not an admin of that team");
      await expect(getServicesTeamSettings(db, team.id)).resolves.toMatchObject({ discordGuildId: null });
    });

    it("refuses a guild that another team already uses", async () => {
      const first = await seedTeamAdmin("discord-admin", "first");
      const firstCode = await createDiscordLinkCode(db, first.team.id);
      const firstResult = await handleDiscordInteraction(
        config,
        { db },
        linkInteraction("discord-admin", String(1 << 5), firstCode.code),
      );
      if (firstResult.kind !== "deferred") throw new Error("expected a deferred reply");
      await firstResult.followUp;

      const second = await seedTeamAdmin("discord-admin-2", "second");
      const secondCode = await createDiscordLinkCode(db, second.team.id);

      const result = await handleDiscordInteraction(
        config,
        { db },
        linkInteraction("discord-admin-2", String(1 << 5), secondCode.code),
      );

      if (result.kind !== "deferred") throw new Error("expected a deferred reply");
      await expect(result.followUp).resolves.toContain("already linked to this server");
      await expect(getServicesTeamSettings(db, second.team.id)).resolves.toMatchObject({ discordGuildId: null });
    });
  });
});

describe("DEFERRED_EPHEMERAL_RESPONSE", () => {
  it("defers with only the EPHEMERAL flag", () => {
    expect(DEFERRED_EPHEMERAL_RESPONSE).toEqual({ type: 5, data: { flags: 64 } });
  });
});

describe("editOriginalInteractionResponse", () => {
  it("edits the original response through the interaction webhook", async () => {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    const fetchStub = (async (url: URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? "") });
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    await editOriginalInteractionResponse(config, "token-1", { content: "Done" }, fetchStub);

    expect(calls).toEqual([
      {
        url: "https://discord.com/api/v10/webhooks/application-1/token-1/messages/@original",
        method: "PATCH",
        body: '{"content":"Done"}',
      },
    ]);
  });
});
