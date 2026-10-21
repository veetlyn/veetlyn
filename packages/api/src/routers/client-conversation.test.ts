import { createTestAuth } from "@jendal-workspace/auth/testing";
import { createFakeFileStore } from "@jendal-workspace/core";
import { user } from "@jendal-workspace/db/schema/auth";
import { member } from "@jendal-workspace/db/schema/organization";
import { servicesTeamSettings } from "@jendal-workspace/db/schema/services-teams";
import {
  createTestDb,
  hasTestDatabase,
  seedClientContact,
  seedOrganization,
  seedProject,
  seedServicesTeam,
  seedServicesTeamMember,
  seedUser,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { createFakeMailer } from "@jendal-workspace/email/fake";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { linkSecret } from "../client-links";
import { makeSession } from "../testing";
import { createTestCatalogServices } from "../testing/catalog";
import { clientTokenFor } from "../testing/client-links";
import { appRouter } from "./index";

describe.skipIf(!hasTestDatabase)("the client's side of the conversation", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  const callerFor = (userId: string | null) =>
    appRouter.createCaller({
      db,
      session: userId ? makeSession(userId) : null,
      environment: "sandbox",
      auth,
      headers: new Headers(),
      catalog: createTestCatalogServices(),
      files: createFakeFileStore(),
      email: {
        mailer: createFakeMailer(),
        siteOrigin: "https://payleor.test",
        dashOrigin: "https://dash.payleor.test",
        storeOrigin: (slug) => `https://${slug}.payleor.test`,
      },
    });

  async function openTeam(slug: string) {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    const team = await seedServicesTeam(db, { organizationId, slug, name: slug, status: "active" });
    await db.update(servicesTeamSettings).set({ quotingMode: "open" }).where(eq(servicesTeamSettings.teamId, team.id));
    return { ownerId, organizationId, teamId: team.id };
  }

  it("groups each freelancer's quote and question for the client, without the team's user ids", async () => {
    const { organizationId, teamId } = await openTeam("walk-crew");
    const aicha = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer", name: "Aïcha" });
    const ben = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer", name: "Ben" });
    const projectId = await seedProject(db, { teamId, source: "web" });
    const token = await clientTokenFor(db, linkSecret(auth), projectId);
    const item = [{ description: "Logo", amountMinor: 15_000, extraDays: 0 }];
    await callerFor(aicha).project.addQuote({ teamSlug: "walk-crew", projectId, items: item, deliveryDays: 4 });
    const asked = await callerFor(ben).project.post({
      teamSlug: "walk-crew",
      projectId,
      kind: "question",
      body: "Do you have the vector file?",
    });
    await callerFor(null).project.clientAnswer({ token, questionId: asked.messageId, body: "Yes, attached in the brief" });
    await callerFor(null).project.clientPost({ token, body: "Only for the team: budget is firm", teamOnly: true });

    const view = await callerFor(null).project.clientGet({ token });
    expect(view.quotes.map((q) => q.freelancer)).toEqual([{ key: "freelancer-1", name: "Aïcha" }]);
    expect(view.conversation.messages.map((m) => [m.kind, m.freelancer?.key ?? null, m.authorName])).toEqual([
      ["event", "freelancer-1", "Payleor"],
      ["question", "freelancer-2", "Ben"],
      ["answer", "freelancer-2", "Client"],
      ["text", null, "Client"],
    ]);
    expect(JSON.stringify(view)).not.toContain(aicha);
    expect(JSON.stringify(view)).not.toContain(ben);
    // The team-only note never reaches the freelancers.
    const forBen = await callerFor(ben).project.get({ teamSlug: "walk-crew", projectId });
    expect(forBen.conversation.messages.map((m) => m.body)).not.toContain("Only for the team: budget is firm");
  });

  it("shows the client the decline reason and that the conversation is closed", async () => {
    const { ownerId, teamId } = await openTeam("walk-crew");
    const projectId = await seedProject(db, { teamId, source: "web" });
    const token = await clientTokenFor(db, linkSecret(auth), projectId);
    await callerFor(ownerId).project.decline({ teamSlug: "walk-crew", projectId, reason: "Fully booked until December." });
    const view = await callerFor(null).project.clientGet({ token });
    expect(view.project).toMatchObject({ status: "declined", declinedReason: "Fully booked until December." });
    expect(view.conversation.canWrite).toBe(false);
  });

  it("lists a signed-in client's projects across teams with each team's own client page", async () => {
    const crew = await openTeam("walk-crew");
    const studio = await openTeam("bright-studio");
    const clientId = await seedUser(db, "Ann");
    await db.update(user).set({ email: "ann@example.com", emailVerified: true }).where(eq(user.id, clientId));
    const verified = [{ kind: "email" as const, value: "ann@example.com", verified: true }];
    const first = await seedProject(db, { teamId: crew.teamId, title: "Logo" });
    await seedClientContact(db, { teamId: crew.teamId, identities: verified, projectId: first });
    const second = await seedProject(db, { teamId: studio.teamId, title: "Website" });
    await seedClientContact(db, { teamId: studio.teamId, identities: [{ kind: "user", value: clientId, verified: true }], projectId: second });
    // Ann also works for a third team; its project naming her email is not hers as a client.
    const own = await openTeam("ann-works-here");
    await db.insert(member).values({
      id: crypto.randomUUID(),
      organizationId: own.organizationId,
      userId: clientId,
      role: "admin",
      createdAt: new Date(),
    });
    const inside = await seedProject(db, { teamId: own.teamId, title: "Internal" });
    await seedClientContact(db, { teamId: own.teamId, identities: verified, projectId: inside });

    const mine = await callerFor(clientId).project.mine({});
    expect(mine.map((p) => [p.title, p.teamName])).toEqual(
      expect.arrayContaining([
        ["Logo", "walk-crew"],
        ["Website", "bright-studio"],
      ]),
    );
    expect(mine).toHaveLength(2);
    const logo = mine.find((p) => p.id === first);
    expect(logo?.clientUrl).toMatch(/^https:\/\/walk-crew\.payleor\.test\/c\//);
  });
});
