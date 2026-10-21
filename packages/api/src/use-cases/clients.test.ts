import { primaryContactFor } from "@jendal-workspace/db/repositories/contacts";
import { user } from "@jendal-workspace/db/schema/auth";
import { clientContact, clientIdentity, projectClient } from "@jendal-workspace/db/schema/contacts";
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

import { signAccountClientLink, signClientLink, signLegacyClientLink } from "../client-links";
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
    await emailedTo(projectId, primary.contactId, "client@example.com");
    const token = await signClientLink(SECRET, { projectId, contactId: primary.contactId, version: 1 });
    return { organizationId, teamId, projectId, contactId: primary.contactId, token };
  }

  // What sending the link by email records.
  async function emailedTo(projectId: string, contactId: string, linkEmail: string) {
    await db
      .update(projectClient)
      .set({ linkEmail })
      .where(and(eq(projectClient.projectId, projectId), eq(projectClient.contactId, contactId)));
  }

  async function identitiesOf(contactId: string) {
    const rows = await db.select().from(clientIdentity).where(eq(clientIdentity.contactId, contactId));
    return Object.fromEntries(rows.map((i) => [`${i.kind}:${i.value}`, i.verifiedAt !== null]));
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
      actor: { kind: "client_account", userId, token: { projectId, contactId } },
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
      projectId,
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
      projectId,
    });
  });

  // The client page runs on the site host, where the dashboard's session cookie never arrives, so the link holder
  // looks signed out: the contact's own addresses decide.
  it("refuses a link whose contact has a team member's address, without a session", async () => {
    const { organizationId, teamId, projectId } = await setup();
    const freelancer = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const [account] = await db.select({ email: user.email }).from(user).where(eq(user.id, freelancer));
    const contactId = await seedClientContact(db, { teamId, identities: [{ kind: "email", value: account!.email }], projectId });
    await emailedTo(projectId, contactId, account!.email);
    const token = await signClientLink(SECRET, { projectId, contactId, version: 1 });

    await expect(resolveClient(db, SECRET, { token })).resolves.toEqual({
      ok: false,
      reason: "team_member",
      projectId,
    });
    expect(await identitiesOf(contactId)).toEqual({ [`email:${account!.email}`]: false });

    // A link sent before contacts acts for the primary, which is refused the same way.
    const legacyProject = await seedProject(db, { teamId, title: "Before contacts", linkVersion: 0 });
    const primary = await primaryContactFor(db, legacyProject);
    await db
      .update(clientIdentity)
      .set({ value: account!.email })
      .where(eq(clientIdentity.contactId, primary!.contactId));
    await expect(resolveClient(db, SECRET, { token: await signLegacyClientLink(SECRET, legacyProject) })).resolves.toEqual({
      ok: false,
      reason: "team_member",
      projectId: legacyProject,
    });
  });

  it("verifies only the address the opened link was emailed to", async () => {
    const { teamId, projectId, contactId, token } = await setup();
    await db.insert(clientIdentity).values({ contactId, teamId, kind: "email", value: "other@example.com", source: "typed" });

    await resolveClient(db, SECRET, { token });

    expect(await identitiesOf(contactId)).toEqual({ "email:client@example.com": true, "email:other@example.com": false });
    const [row] = await db.select().from(clientIdentity).where(eq(clientIdentity.value, "client@example.com"));
    expect(row).toMatchObject({ source: "typed" });
    expect(projectId).toBeTruthy();
  });

  it("verifies nothing through the link given to a signed-in client, though it opens the page", async () => {
    const { projectId, contactId } = await setup();
    const { linkVersion } = (await primaryContactFor(db, projectId))!;
    const token = await signAccountClientLink(SECRET, { projectId, contactId, version: linkVersion });

    await expect(resolveClient(db, SECRET, { token })).resolves.toMatchObject({ ok: true, contactId });

    expect(await identitiesOf(contactId)).toEqual({ "email:client@example.com": false });
  });

  it("verifies nothing through a link that was never emailed, or one sent before contacts", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const shown = await seedProject(db, { teamId, title: "Shown to the team" });
    const shownContact = (await primaryContactFor(db, shown))!.contactId;
    const legacy = await seedProject(db, { teamId, title: "Migrated", clientEmail: "old@example.com", linkVersion: 0 });
    const legacyContact = (await primaryContactFor(db, legacy))!.contactId;
    // Even if the address was recorded, a legacy link was visible to the team and proves nothing.
    await emailedTo(legacy, legacyContact, "old@example.com");

    const shownToken = await signClientLink(SECRET, { projectId: shown, contactId: shownContact, version: 1 });
    await expect(resolveClient(db, SECRET, { token: shownToken })).resolves.toMatchObject({ ok: true });
    await expect(resolveClient(db, SECRET, { token: await signLegacyClientLink(SECRET, legacy) })).resolves.toMatchObject({
      ok: true,
    });

    expect((await db.select().from(clientIdentity)).every((i) => i.verifiedAt === null)).toBe(true);
  });

  it("merges into the contact already holding the proved address verified, and the link keeps working", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const knownProject = await seedProject(db, { teamId, title: "Known" });
    const known = (await primaryContactFor(db, knownProject))!.contactId;
    await db.update(clientIdentity).set({ verifiedAt: new Date() }).where(eq(clientIdentity.contactId, known));
    const newProject = await seedProject(db, { teamId, title: "New" });
    const fresh = (await primaryContactFor(db, newProject))!.contactId;
    await emailedTo(newProject, fresh, "client@example.com");
    await db.insert(clientIdentity).values({ contactId: fresh, teamId, kind: "discord", value: "D1", source: "typed" });
    const token = await signClientLink(SECRET, { projectId: newProject, contactId: fresh, version: 1 });

    await expect(resolveClient(db, SECRET, { token })).resolves.toMatchObject({ ok: true, contactId: known });

    expect(await primaryContactFor(db, newProject)).toMatchObject({ contactId: known, linkVersion: 1 });
    expect(await identitiesOf(known)).toEqual({ "email:client@example.com": true, "discord:D1": false });
    expect(await db.select().from(clientContact).where(eq(clientContact.id, fresh))).toEqual([]);
    await expect(resolveClient(db, SECRET, { token })).resolves.toMatchObject({ ok: true, contactId: known });
    // The merged link opens its own project only, not the projects of the contact it joined.
    const elsewhere = await signClientLink(SECRET, { projectId: knownProject, contactId: fresh, version: 1 });
    await expect(resolveClient(db, SECRET, { token: elsewhere })).resolves.toMatchObject({ ok: false });
  });

  it("never merges through an address the opened link did not prove", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    await seedClientContact(db, { teamId, identities: [{ kind: "email", value: "victim@example.com", verified: true }] });
    const projectId = await seedProject(db, { teamId, clientEmail: "attacker@example.com" });
    const contactId = (await primaryContactFor(db, projectId))!.contactId;
    await db.insert(clientIdentity).values({ contactId, teamId, kind: "email", value: "victim@example.com", source: "typed" });
    await emailedTo(projectId, contactId, "attacker@example.com");
    const token = await signClientLink(SECRET, { projectId, contactId, version: 1 });

    await expect(resolveClient(db, SECRET, { token })).resolves.toMatchObject({ ok: true, contactId });
    expect(await identitiesOf(contactId)).toEqual({ "email:attacker@example.com": true, "email:victim@example.com": false });
  });

  it("keeps a removed contact's links dead after it is merged into a contact still on the project", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });
    const survivor = (await primaryContactFor(db, projectId))!.contactId;
    await db.update(clientIdentity).set({ verifiedAt: new Date() }).where(eq(clientIdentity.contactId, survivor));
    const removed = await seedClientContact(db, {
      teamId,
      identities: [{ kind: "email", value: "client@example.com" }],
      projectId,
    });
    const removedToken = await signClientLink(SECRET, { projectId, contactId: removed, version: 1 });
    await db.delete(projectClient).where(and(eq(projectClient.projectId, projectId), eq(projectClient.contactId, removed)));
    // The removed contact proves its address on another project and merges into the survivor.
    const otherProject = await seedProject(db, { teamId, title: "Other", clientEmail: "someone@example.com" });
    await db.insert(projectClient).values({ projectId: otherProject, contactId: removed, linkEmail: "client@example.com" });
    const otherToken = await signClientLink(SECRET, { projectId: otherProject, contactId: removed, version: 1 });
    await expect(resolveClient(db, SECRET, { token: otherToken })).resolves.toMatchObject({ ok: true, contactId: survivor });

    await expect(resolveClient(db, SECRET, { token: removedToken })).resolves.toEqual({ ok: false, reason: "invalid_link" });
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
