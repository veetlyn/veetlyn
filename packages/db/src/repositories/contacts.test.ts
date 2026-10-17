import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { clientContact, clientIdentity } from "../schema/contacts";
import {
  createTestDb,
  hasTestDatabase,
  seedClientContact,
  seedProject,
  seedServicesTeamWithAdmin,
  truncateAll,
} from "../testing/db";
import { countOpenRequestsForEmail, matchOrCreateContact } from "./contacts";

describe.skipIf(!hasTestDatabase)("client contacts", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("counts only the email's web requests in open statuses, for that team", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const { teamId: otherTeamId } = await seedServicesTeamWithAdmin(db, { slug: "other" });
    const email = "asker@example.com";

    await seedProject(db, { teamId, clientEmail: email, source: "web", status: "quoting" });
    await seedProject(db, { teamId, clientEmail: email, source: "web", status: "in_progress" });
    await seedProject(db, { teamId, clientEmail: email, source: "web", status: "completed" });
    await seedProject(db, { teamId, clientEmail: email, source: "web", status: "cancelled" });
    await seedProject(db, { teamId, clientEmail: email, source: "admin", status: "quoting" });
    await seedProject(db, { teamId, clientEmail: "other@example.com", source: "web", status: "quoting" });
    await seedProject(db, { teamId: otherTeamId, clientEmail: email, source: "web", status: "quoting" });

    await expect(countOpenRequestsForEmail(db, { teamId, email })).resolves.toBe(2);
  });

  it("creates one contact when two starts race for the same email", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const input = { teamId, email: "Race@Example.com", discordId: null, name: "Race", source: "typed" as const };

    const ids = await Promise.all([
      db.transaction((tx) => matchOrCreateContact(tx, input)),
      db.transaction((tx) => matchOrCreateContact(tx, input)),
    ]);

    expect(ids[0]).toBe(ids[1]);
    expect(await db.select().from(clientContact)).toHaveLength(1);
    expect(await db.select().from(clientIdentity)).toEqual([
      expect.objectContaining({ kind: "email", value: "race@example.com", source: "typed", verifiedAt: null }),
    ]);
  });

  it("never joins a public request to a contact whose email is verified", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const verified = await seedClientContact(db, {
      teamId,
      identities: [{ kind: "email", value: "known@example.com", verified: true }],
    });
    const request = { teamId, email: "known@example.com", discordId: null, name: "Someone", source: "request" as const };

    const fromRequest = await db.transaction((tx) => matchOrCreateContact(tx, request));
    expect(fromRequest).not.toBe(verified);
    await expect(db.transaction((tx) => matchOrCreateContact(tx, request))).resolves.toBe(fromRequest);
    await expect(
      db.transaction((tx) => matchOrCreateContact(tx, { ...request, source: "typed" })),
    ).resolves.toBe(verified);
  });
});
