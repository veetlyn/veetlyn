import { primaryContactFor } from "@jendal-workspace/db/repositories/contacts";
import { findProjectById } from "@jendal-workspace/db/repositories/projects";
import { clientContact, clientIdentity, projectClient } from "@jendal-workspace/db/schema/contacts";
import { outbox } from "@jendal-workspace/db/schema/outbox";
import {
  createTestDb,
  hasTestDatabase,
  seedServicesTeamMember,
  seedServicesTeamWithAdmin,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { createFakeMailer } from "@jendal-workspace/email/fake";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { signClientLink } from "../client-links";
import type { EmailServices } from "../context";
import { addProjectClient, emailClientLink, reissueClientLink, removeProjectClient, resolveClient } from "./clients";
import { type ProjectActor, startProject } from "./projects";

const SECRET = "test-secret-that-is-at-least-32-characters";

describe.skipIf(!hasTestDatabase)("project contacts", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  function depsWithMailer() {
    const mailer = createFakeMailer();
    const email: EmailServices = {
      mailer,
      siteOrigin: "https://payleor.test",
      platformName: "Platform",
      dashOrigin: "https://dash.payleor.test",
      storeOrigin: (slug) => `https://${slug}.payleor.test`,
    };
    return { deps: { db, auth: { options: { secret: SECRET } }, email }, mailer };
  }

  function linkIn(text: string): string {
    const match = /https:\/\/team\.payleor\.test\/c\/(\S+)/.exec(text);
    if (!match?.[1]) throw new Error("no client link in the email");
    return match[1];
  }

  async function setup() {
    const { organizationId, teamId, userId } = await seedServicesTeamWithAdmin(db);
    const admin: ProjectActor = { teamId, role: "admin", actorId: userId };
    const freelancerId = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const freelancer: ProjectActor = { teamId, role: "freelancer", actorId: freelancerId };
    const { projectId } = await startProject(db, admin, {
      title: "Website",
      clientEmail: "Ann@Example.com",
      clientDiscordId: "D-ann",
      clientName: "Ann",
    });
    const primary = await primaryContactFor(db, projectId);
    if (!primary) throw new Error("missing primary contact");
    return { teamId, admin, freelancer, projectId, primary };
  }

  async function contactsOf(projectId: string) {
    return db.select().from(projectClient).where(eq(projectClient.projectId, projectId));
  }

  async function eventsOf(projectId: string) {
    return db.select().from(outbox).where(eq(outbox.projectId, projectId)).orderBy(asc(outbox.sequence));
  }

  it("starts a project with a typed, unverified primary contact matched by email", async () => {
    const { teamId, admin, projectId, primary } = await setup();
    expect(primary).toMatchObject({ name: "Ann", linkVersion: 1 });
    expect(await db.select().from(clientIdentity).where(eq(clientIdentity.contactId, primary.contactId))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "email", value: "ann@example.com", source: "typed", verifiedAt: null }),
        expect.objectContaining({ kind: "discord", value: "D-ann", source: "typed", verifiedAt: null }),
      ]),
    );
    const { projectId: second } = await startProject(db, admin, { title: "Second site", clientEmail: "ann@example.com" });
    expect((await primaryContactFor(db, second))?.contactId).toBe(primary.contactId);
    expect(await db.select().from(clientContact).where(eq(clientContact.teamId, teamId))).toHaveLength(1);
    const [created] = await eventsOf(projectId);
    expect(created?.data).toEqual({
      projectId,
      title: "Website",
      contactIds: [primary.contactId],
      clientName: "Ann",
      channelId: null,
    });
  });

  it("adds a contact without bumping the project version, so work in flight does not conflict", async () => {
    const { admin, projectId } = await setup();
    const before = await findProjectById(db, projectId);

    const { contactId } = await addProjectClient(db, admin, { projectId, email: "Bob@Example.com", name: "" });

    expect(await contactsOf(projectId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ contactId, isPrimary: false, linkVersion: 1, addedById: admin.actorId }),
      ]),
    );
    expect(await db.select().from(clientContact).where(eq(clientContact.id, contactId))).toEqual([
      expect.objectContaining({ name: "bob" }),
    ]);
    expect(await findProjectById(db, projectId)).toMatchObject({ version: before?.version });
    expect((await eventsOf(projectId)).map((e) => e.type)).toEqual(["project.created", "project.client_added"]);
    await expect(addProjectClient(db, admin, { projectId, email: "bob@example.com", name: "" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "That client is already on this project.",
    });
  });

  it("lets only admins and managers change a project's clients", async () => {
    const { freelancer, projectId, primary } = await setup();
    const { deps } = depsWithMailer();
    const refused = { code: "FORBIDDEN", message: "Only admins and managers change a project's clients." };
    const target = { projectId, contactId: primary.contactId };
    await expect(addProjectClient(db, freelancer, { projectId, email: "x@example.com", name: "" })).rejects.toMatchObject(
      refused,
    );
    await expect(removeProjectClient(db, freelancer, target)).rejects.toMatchObject(refused);
    await expect(reissueClientLink(deps, freelancer, target)).rejects.toMatchObject(refused);
    await expect(emailClientLink(deps, freelancer, target)).rejects.toMatchObject(refused);
  });

  it("refuses to remove the last contact and moves primary when the primary is removed", async () => {
    const { admin, projectId, primary } = await setup();
    const target = { projectId, contactId: primary.contactId };
    await expect(removeProjectClient(db, admin, target)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "A project keeps at least one client.",
    });
    const { contactId: second } = await addProjectClient(db, admin, { projectId, email: "bob@example.com", name: "Bob" });
    const before = await findProjectById(db, projectId);

    await removeProjectClient(db, admin, target);

    expect(await contactsOf(projectId)).toEqual([expect.objectContaining({ contactId: second, isPrimary: true })]);
    expect(await findProjectById(db, projectId)).toMatchObject({ version: before?.version });
    expect((await eventsOf(projectId)).at(-1)).toMatchObject({
      type: "project.client_removed",
      data: { contactId: primary.contactId },
    });
  });

  it("emails the current link, and opening it proves that address", async () => {
    const { admin, projectId, primary } = await setup();
    const { deps, mailer } = depsWithMailer();

    await emailClientLink(deps, admin, { projectId, contactId: primary.contactId });

    expect(mailer.sent).toEqual([expect.objectContaining({ to: "ann@example.com", subject: "Your project with team" })]);
    const token = linkIn(mailer.sent[0]?.text ?? "");
    await expect(resolveClient(db, SECRET, { token })).resolves.toMatchObject({ ok: true, contactId: primary.contactId });
    expect(await db.select().from(clientIdentity).where(eq(clientIdentity.kind, "email"))).toEqual([
      expect.objectContaining({ value: "ann@example.com", verifiedAt: expect.any(Date) }),
    ]);
  });

  it("proves no address when the same link version went to two addresses", async () => {
    const { teamId, admin, projectId, primary } = await setup();
    await db.insert(clientIdentity).values({
      contactId: primary.contactId,
      teamId,
      kind: "email",
      value: "ann.other@example.com",
      source: "typed",
    });
    const { deps, mailer } = depsWithMailer();
    const target = { projectId, contactId: primary.contactId };

    await emailClientLink(deps, admin, { ...target, email: "ann@example.com" });
    await emailClientLink(deps, admin, { ...target, email: "ann.other@example.com" });
    await resolveClient(db, SECRET, { token: linkIn(mailer.sent[0]?.text ?? "") });

    expect((await db.select().from(clientIdentity)).every((i) => i.verifiedAt === null)).toBe(true);
  });

  it("reissues a link: old links die and the new one is emailed", async () => {
    const { admin, projectId, primary } = await setup();
    const { deps, mailer } = depsWithMailer();
    const old = await signClientLink(SECRET, { projectId, contactId: primary.contactId, version: 1 });

    await reissueClientLink(deps, admin, { projectId, contactId: primary.contactId });

    await expect(resolveClient(db, SECRET, { token: old })).resolves.toMatchObject({ ok: false, reason: "invalid_link" });
    await expect(resolveClient(db, SECRET, { token: linkIn(mailer.sent[0]?.text ?? "") })).resolves.toMatchObject({
      ok: true,
    });
    expect(await primaryContactFor(db, projectId)).toMatchObject({ linkVersion: 2 });
    expect((await eventsOf(projectId)).map((e) => e.type)).toEqual([
      "project.created",
      "project.client_link_reissued",
      "project.client_link_sent",
    ]);
  });
});
