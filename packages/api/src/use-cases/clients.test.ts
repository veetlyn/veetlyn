import { primaryContactFor } from "@jendal-workspace/db/repositories/contacts";
import { projectClient } from "@jendal-workspace/db/schema/contacts";
import {
  createTestDb,
  hasTestDatabase,
  seedClientContact,
  seedProject,
  seedServicesTeamWithAdmin,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { signClientLink, signLegacyClientLink } from "../client-links";
import { resolveClientLink } from "./clients";

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

    await expect(resolveClientLink(db, SECRET, token)).resolves.toMatchObject({ projectId, contactId });
    await expect(resolveClientLink(db, SECRET, foreign)).resolves.toBeNull();

    await setLinkVersion(projectId, contactId, 2);
    await expect(resolveClientLink(db, SECRET, token)).resolves.toBeNull();

    await db.delete(projectClient).where(eq(projectClient.contactId, second));
    await expect(resolveClientLink(db, SECRET, secondToken)).resolves.toBeNull();
  });

  it("resolves a link sent before contacts to the primary contact until the link is reissued", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId, linkVersion: 0 });
    const { contactId } = await primaryOf(projectId);
    const legacy = await signLegacyClientLink(SECRET, projectId);

    await expect(resolveClientLink(db, SECRET, legacy)).resolves.toMatchObject({ projectId, contactId });

    await setLinkVersion(projectId, contactId, 1);
    await expect(resolveClientLink(db, SECRET, legacy)).resolves.toBeNull();
  });
});
