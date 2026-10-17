import { primaryContactFor } from "@jendal-workspace/db/repositories/contacts";
import { clientContact, clientIdentity, projectClient } from "@jendal-workspace/db/schema/contacts";
import { project } from "@jendal-workspace/db/schema/projects";
import { createTestDb, hasTestDatabase, seedServicesTeamWithAdmin, truncateAll } from "@jendal-workspace/db/testing/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { signLegacyClientLink } from "../client-links";
import { resolveClient } from "../use-cases/clients";
import { backfillLegacyProjects } from "./backfill-contacts";

const SECRET = "test-secret-that-is-at-least-32-characters";

describe.skipIf(!hasTestDatabase)("client contact backfill", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  // A project as it was before contacts: the client only in the legacy columns.
  async function legacyProject(
    teamId: string,
    client: { clientEmail?: string; clientDiscordId?: string; clientName?: string },
    createdAt: Date,
  ): Promise<string> {
    const [row] = await db
      .insert(project)
      .values({ teamId, title: "Old project", currency: "USD", managementFeeBps: 1_000, teamCutBps: 1_500, createdAt, ...client })
      .returning({ id: project.id });
    if (!row) throw new Error("Insert into project returned no row");
    return row.id;
  }

  const day = (n: number) => new Date(Date.UTC(2026, 9, n));

  async function primaryOf(projectId: string) {
    const primary = await primaryContactFor(db, projectId);
    if (!primary) throw new Error("no primary contact");
    return primary;
  }

  async function identitiesOf(contactId: string) {
    const rows = await db.select().from(clientIdentity).where(eq(clientIdentity.contactId, contactId));
    return rows.map((i) => [i.kind, i.value, i.source, i.verifiedAt]).sort();
  }

  it("moves an email-only, a Discord-only and a both project onto unverified migrated contacts", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const emailOnly = await legacyProject(teamId, { clientEmail: "Ann@Example.com", clientName: "Ann" }, day(1));
    const discordOnly = await legacyProject(teamId, { clientDiscordId: "D-bob" }, day(2));
    const both = await legacyProject(teamId, { clientEmail: "cat@example.com", clientDiscordId: "D-cat" }, day(3));

    await expect(backfillLegacyProjects(db)).resolves.toEqual({ projects: 3, contactsCreated: 3, conflicts: [] });

    const ann = await primaryOf(emailOnly);
    expect(ann).toMatchObject({ name: "Ann", linkVersion: 0 });
    expect(await identitiesOf(ann.contactId)).toEqual([["email", "ann@example.com", "migration", null]]);
    const bob = await primaryOf(discordOnly);
    expect(bob).toMatchObject({ name: "Client", linkVersion: 0 });
    expect(await identitiesOf(bob.contactId)).toEqual([["discord", "D-bob", "migration", null]]);
    const cat = await primaryOf(both);
    expect(cat).toMatchObject({ name: "cat", linkVersion: 0 });
    expect(await identitiesOf(cat.contactId)).toEqual([
      ["discord", "D-cat", "migration", null],
      ["email", "cat@example.com", "migration", null],
    ]);
    await expect(backfillLegacyProjects(db)).resolves.toEqual({ projects: 0, contactsCreated: 0, conflicts: [] });
  });

  it("gives the same email on two projects one contact", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const first = await legacyProject(teamId, { clientEmail: "ann@example.com" }, day(1));
    const second = await legacyProject(teamId, { clientEmail: "ANN@example.com" }, day(2));
    const { teamId: otherTeam } = await seedServicesTeamWithAdmin(db, { slug: "other" });
    const elsewhere = await legacyProject(otherTeam, { clientEmail: "ann@example.com" }, day(3));

    await expect(backfillLegacyProjects(db)).resolves.toMatchObject({ projects: 3, contactsCreated: 2 });

    expect((await primaryOf(second)).contactId).toBe((await primaryOf(first)).contactId);
    expect((await primaryOf(elsewhere)).contactId).not.toBe((await primaryOf(first)).contactId);
  });

  it("keeps contacts apart when an email and a Discord id point at different ones, and records the conflict", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const byEmail = await legacyProject(teamId, { clientEmail: "a@example.com" }, day(1));
    const byDiscord = await legacyProject(teamId, { clientDiscordId: "D" }, day(2));
    const both = await legacyProject(teamId, { clientEmail: "a@example.com", clientDiscordId: "D" }, day(3));

    const summary = await backfillLegacyProjects(db);

    expect(summary).toMatchObject({ projects: 3, contactsCreated: 2 });
    expect(summary.conflicts).toEqual([`project ${both}: Discord D belongs to another contact; contacts kept apart`]);
    const a = (await primaryOf(byEmail)).contactId;
    expect((await primaryOf(both)).contactId).toBe(a);
    expect(await identitiesOf(a)).toEqual([["email", "a@example.com", "migration", null]]);
    expect(await identitiesOf((await primaryOf(byDiscord)).contactId)).toEqual([["discord", "D", "migration", null]]);
    expect(await db.select().from(clientContact)).toHaveLength(2);
  });

  it("keeps a link sent before contacts working, without verifying anything", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await legacyProject(teamId, { clientEmail: "ann@example.com" }, day(1));
    const sentBefore = await signLegacyClientLink(SECRET, projectId);
    await expect(resolveClient(db, SECRET, { token: sentBefore })).resolves.toMatchObject({ ok: false });

    await backfillLegacyProjects(db);

    const { contactId } = await primaryOf(projectId);
    await expect(resolveClient(db, SECRET, { token: sentBefore })).resolves.toMatchObject({ ok: true, contactId });
    expect(await db.select().from(projectClient)).toEqual([expect.objectContaining({ linkVersion: 0, linkEmail: null })]);
    expect(await identitiesOf(contactId)).toEqual([["email", "ann@example.com", "migration", null]]);
  });
});
