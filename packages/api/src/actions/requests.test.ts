import { createFakeFileStore } from "@jendal-workspace/core";
import { findProjectById } from "@jendal-workspace/db/repositories/projects";
import { user } from "@jendal-workspace/db/schema/auth";
import { clientIdentity, projectClient } from "@jendal-workspace/db/schema/contacts";
import {
  createTestDb,
  hasTestDatabase,
  seedClientContact,
  seedOrganization,
  seedServicesTeam,
  seedServicesTeamMember,
  seedUser,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { createFakeMailer } from "@jendal-workspace/email/fake";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { Surface } from "./actors";
import { perform } from "./perform";
import { createRequest } from "./requests";
import type { EmailServices } from "../context";
import { deliverDueOutboxDeliveries } from "../use-cases/outbox-dispatcher";

describe.skipIf(!hasTestDatabase)("request.create from a signed-in client", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function setup() {
    const { organizationId, userId: ownerId } = await seedOrganization(db);
    const team = await seedServicesTeam(db, { organizationId, slug: "walk-crew", name: "Walk Crew", status: "active" });
    const clientId = await seedUser(db, "Ann");
    await db.update(user).set({ email: "Ann@Example.com", emailVerified: true }).where(eq(user.id, clientId));
    return { organizationId, teamId: team.id, clientId, ownerId };
  }

  function request(userId: string, surface: Surface = "mcp") {
    const mailer = createFakeMailer();
    const email: EmailServices = {
      mailer, siteOrigin: "https://platform.test", platformName: "Platform", dashOrigin: "https://dash.platform.test",
      storeOrigin: (slug) => `https://${slug}.platform.test`,
    };
    const run = () =>
      perform(
        {
          deps: {
            db,
            platformName: "Platform",
            files: createFakeFileStore(),
            auth: { options: { secret: "test-secret-that-is-at-least-32-characters" } },
            email,
          },
          actor: { kind: "user", userId },
          surface,
          request: { requestId: crypto.randomUUID(), ip: null },
        },
        createRequest,
        {
          slug: "walk-crew",
          offeringId: null,
          // The AI fills these from the account; the account wins.
          name: "Ann",
          email: "someone-else@example.com",
          description: "A logo for my bakery, warm colours, ready in a week.",
          answers: [],
          website: "",
        },
      );
    return { run, mailer, email };
  }

  it("attaches the account's verified contact, records the AI as home and emails the account", async () => {
    const { teamId, clientId, ownerId } = await setup();
    const { run, mailer, email } = request(clientId);
    const { projectId } = await run();
    if (!projectId) throw new Error("no project id for a signed-in requester");
    expect(await findProjectById(db, projectId)).toMatchObject({ teamId, clientHomeSurface: "mcp", source: "web" });
    const [attached] = await db.select().from(projectClient).where(eq(projectClient.projectId, projectId));
    const identities = await db.select().from(clientIdentity).where(eq(clientIdentity.contactId, attached?.contactId ?? ""));
    expect(identities.map((i) => [i.kind, i.value, i.source, i.verifiedAt !== null]).sort()).toEqual([
      ["email", "ann@example.com", "account", true],
      ["user", clientId, "account", true],
    ]);
    expect(mailer.sent).toEqual([]);
    await deliverDueOutboxDeliveries({ db, email, secret: "test-secret-that-is-at-least-32-characters" });
    expect(mailer.sent.map((m) => m.to).sort()).toEqual(["ann@example.com", `${ownerId}@example.com`].sort());

    const second = await request(clientId).run();
    const [again] = await db.select().from(projectClient).where(eq(projectClient.projectId, second.projectId ?? ""));
    expect(again?.contactId).toBe(attached?.contactId);
  });

  it("joins the contact whose email a client link already proved, adding the account to it", async () => {
    const { teamId, clientId } = await setup();
    const proved = await seedClientContact(db, {
      teamId,
      identities: [{ kind: "email", value: "ann@example.com", verified: true, source: "request" }],
    });
    const { projectId } = await request(clientId).run();
    const [attached] = await db.select().from(projectClient).where(eq(projectClient.projectId, projectId ?? ""));
    expect(attached?.contactId).toBe(proved);
  });

  it("refuses a member of the team as its client", async () => {
    const { organizationId, teamId } = await setup();
    const memberId = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, memberId));
    await expect(request(memberId).run()).rejects.toMatchObject({ code: "forbidden" });
  });

  it("keeps the three-open-requests limit for the account's contact", async () => {
    const { clientId } = await setup();
    for (let i = 0; i < 3; i += 1) await request(clientId).run();
    await expect(request(clientId).run()).rejects.toThrow("You already have 3 open requests with this team.");
  });
});
