import { primaryContactFor } from "@jendal-workspace/db/repositories/contacts";
import { user } from "@jendal-workspace/db/schema/auth";
import { clientIdentity, projectClient } from "@jendal-workspace/db/schema/contacts";
import {
  createTestDb,
  hasTestDatabase,
  seedClientContact,
  seedProject,
  seedServicesTeamMember,
  seedServicesTeamWithAdmin,
  seedUser,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { signClientLink, signLegacyClientLink } from "../client-links";
import { resolveClient } from "./clients";

const SECRET = "test-secret-that-is-at-least-32-characters";

describe.skipIf(!hasTestDatabase)("client links against the contacts", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function primaryOf(projectId: string) {
    const primary = await primaryContactFor(db, projectId);
    if (!primary) throw new Error("missing primary contact");
    return primary;
  }

  async function linkedContact(token: string) {
    const resolved = await resolveClient(db, SECRET, { token });
    return resolved.ok && resolved.actor.kind === "client_link" ? resolved.actor.token : null;
  }

  async function setLinkVersion(projectId: string, contactId: string, linkVersion: number) {
    await db
      .update(projectClient)
      .set({ linkVersion })
      .where(and(eq(projectClient.projectId, projectId), eq(projectClient.contactId, contactId)));
  }

  it("resolves a link of an attached contact at the current version, and no other", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });
    const otherProjectId = await seedProject(db, { teamId, title: "Other" });
    const second = await seedClientContact(db, {
      teamId,
      identities: [{ kind: "email", value: "second@example.com" }],
      projectId,
    });
    const { contactId } = await primaryOf(projectId);
    const token = await signClientLink(SECRET, { projectId, contactId, version: 1 });
    const secondToken = await signClientLink(SECRET, { projectId, contactId: second, version: 1 });
    const foreign = await signClientLink(SECRET, { projectId: otherProjectId, contactId, version: 1 });

    await expect(linkedContact(token)).resolves.toMatchObject({ projectId, contactId });
    await expect(linkedContact(foreign)).resolves.toBeNull();

    await setLinkVersion(projectId, contactId, 2);
    await expect(linkedContact(token)).resolves.toBeNull();

    await db.delete(projectClient).where(eq(projectClient.contactId, second));
    await expect(linkedContact(secondToken)).resolves.toBeNull();
  });

  it("resolves a link sent before contacts to the primary contact until the link is reissued", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId, linkVersion: 0 });
    const { contactId } = await primaryOf(projectId);
    const legacy = await signLegacyClientLink(SECRET, projectId);

    await expect(linkedContact(legacy)).resolves.toMatchObject({ projectId, contactId });

    await setLinkVersion(projectId, contactId, 1);
    await expect(linkedContact(legacy)).resolves.toBeNull();
  });
});

describe.skipIf(!hasTestDatabase)("the client rule", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function setup() {
    const { organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });
    const primary = await primaryContactFor(db, projectId);
    if (!primary) throw new Error("missing primary contact");
    const token = await signClientLink(SECRET, { projectId, contactId: primary.contactId, version: 1 });
    return { organizationId, teamId, projectId, contactId: primary.contactId, token };
  }

  async function userWithEmail(email: string, verified = true) {
    const userId = await seedUser(db, "Someone");
    await db.update(user).set({ email, emailVerified: verified }).where(eq(user.id, userId));
    return userId;
  }

  it("accepts the holder of a valid link as that contact", async () => {
    const { projectId, contactId, token } = await setup();
    await expect(resolveClient(db, SECRET, { token })).resolves.toEqual({
      ok: true,
      contactId,
      actor: { kind: "client_link", token: { projectId, contactId } },
    });
    await expect(resolveClient(db, SECRET, { token: `${token}x` })).resolves.toEqual({
      ok: false,
      reason: "invalid_link",
    });
  });

  it("accepts a signed-in user with a user identity on an attached contact", async () => {
    const { teamId, projectId } = await setup();
    const userId = await seedUser(db, "Client");
    const contactId = await seedClientContact(db, {
      teamId,
      identities: [{ kind: "user", value: userId, verified: true, source: "account" }],
      projectId,
    });
    await expect(resolveClient(db, SECRET, { projectId, userId })).resolves.toEqual({
      ok: true,
      contactId,
      actor: { kind: "user", userId },
    });
  });

  it("accepts a verified account email only when it matches a verified email identity", async () => {
    const { teamId, projectId } = await setup();
    const verifiedContact = await seedClientContact(db, {
      teamId,
      identities: [{ kind: "email", value: "verified@example.com", verified: true }],
      projectId,
    });
    await seedClientContact(db, { teamId, identities: [{ kind: "email", value: "typed@example.com" }], projectId });

    const matching = await userWithEmail("Verified@Example.com");
    await expect(resolveClient(db, SECRET, { projectId, userId: matching })).resolves.toMatchObject({
      ok: true,
      contactId: verifiedContact,
    });
    // The seeded primary's identity is unverified, like any typed or requested address.
    const unverifiedIdentity = await userWithEmail("typed@example.com");
    await expect(resolveClient(db, SECRET, { projectId, userId: unverifiedIdentity })).resolves.toEqual({
      ok: false,
      reason: "not_a_client",
    });
    const unverifiedAccount = await userWithEmail("verified2@example.com", false);
    await db
      .update(clientIdentity)
      .set({ value: "verified2@example.com" })
      .where(eq(clientIdentity.contactId, verifiedContact));
    await expect(resolveClient(db, SECRET, { projectId, userId: unverifiedAccount })).resolves.toEqual({
      ok: false,
      reason: "not_a_client",
    });
  });

  it("refuses team members, even holding a valid link or a matching verified email", async () => {
    const { organizationId, teamId, projectId, token } = await setup();
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    await expect(resolveClient(db, SECRET, { token, userId: freelancer })).resolves.toEqual({
      ok: false,
      reason: "team_member",
    });
    // A member opening the link proves nothing about the client's address.
    expect((await db.select().from(clientIdentity)).every((i) => i.verifiedAt === null)).toBe(true);

    const manager = await seedServicesTeamMember(db, { organizationId, teamId, role: "manager" });
    const [account] = await db.select({ email: user.email }).from(user).where(eq(user.id, manager));
    await db.update(user).set({ emailVerified: true }).where(eq(user.id, manager));
    await seedClientContact(db, {
      teamId,
      identities: [{ kind: "email", value: account!.email, verified: true }],
      projectId,
    });
    await expect(resolveClient(db, SECRET, { projectId, userId: manager })).resolves.toEqual({
      ok: false,
      reason: "team_member",
    });
  });

  it("verifies the contact's email when its link is opened", async () => {
    const { contactId, token } = await setup();
    await resolveClient(db, SECRET, { token });
    expect(await db.select().from(clientIdentity).where(eq(clientIdentity.contactId, contactId))).toEqual([
      expect.objectContaining({ kind: "email", value: "client@example.com", source: "typed", verifiedAt: expect.any(Date) }),
    ]);
  });

  it("merges the contact into the one already holding its email verified, and its links keep working", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const knownProject = await seedProject(db, { teamId, title: "Known" });
    const known = (await primaryContactFor(db, knownProject))!.contactId;
    await db.update(clientIdentity).set({ verifiedAt: new Date() }).where(eq(clientIdentity.contactId, known));
    const newProject = await seedProject(db, { teamId, title: "New" });
    const fresh = (await primaryContactFor(db, newProject))!.contactId;
    await db.insert(clientIdentity).values({ contactId: fresh, teamId, kind: "discord", value: "D1", source: "typed" });
    const token = await signClientLink(SECRET, { projectId: newProject, contactId: fresh, version: 1 });

    await expect(resolveClient(db, SECRET, { token })).resolves.toMatchObject({ ok: true, contactId: known });

    expect(await primaryContactFor(db, newProject)).toMatchObject({ contactId: known, linkVersion: 1 });
    const identities = await db.select().from(clientIdentity).where(eq(clientIdentity.teamId, teamId));
    expect(identities.map((i) => [i.contactId === known, i.kind, i.value, i.verifiedAt !== null])).toEqual(
      expect.arrayContaining([
        [true, "email", "client@example.com", true],
        [true, "discord", "D1", false],
      ]),
    );
    expect(identities).toHaveLength(2);
    expect(await db.select().from(projectClient).where(eq(projectClient.contactId, fresh))).toEqual([]);
    await expect(resolveClient(db, SECRET, { token })).resolves.toMatchObject({ ok: true, contactId: known });
  });

  it("refuses a stranger with no link and no identity", async () => {
    const { projectId } = await setup();
    const stranger = await userWithEmail("stranger@example.com");
    await expect(resolveClient(db, SECRET, { projectId, userId: stranger })).resolves.toEqual({
      ok: false,
      reason: "not_a_client",
    });
  });
});
