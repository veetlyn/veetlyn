import { createTestAuth } from "@jendal-workspace/auth/testing";
import { createFakeFileStore } from "@jendal-workspace/core";
import {
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedPayment,
  seedProject,
  seedServicesTeam,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { linkSecret, signPayLink } from "../client-links";
import { clientTokenFor } from "../testing/client-links";
import { createTestCatalogServices } from "../testing/catalog";
import { appRouter } from "./index";

// The web Worker serves client and pay pages only on the host this names, so a token never opens on another
// team's site.
describe.skipIf(!hasTestDatabase)("project.linkTeam", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);
  const secret = linkSecret(auth);

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  const caller = () =>
    appRouter.createCaller({
      db,
      session: null,
      environment: "sandbox",
      platformName: "Platform",
      auth,
      headers: new Headers(),
      catalog: createTestCatalogServices(),
      files: createFakeFileStore(),
    });

  it("names the project's own team for its client and pay links, and nothing for a forged one", async () => {
    const { organizationId } = await seedOrganization(db);
    const crew = await seedServicesTeam(db, { organizationId, slug: "walk-crew", status: "active" });
    await seedServicesTeam(db, { organizationId, slug: "other-team", status: "active" });
    const projectId = await seedProject(db, { teamId: crew.id });
    const payment = await seedPayment(db, { projectId, teamId: crew.id, status: "pending" });

    const clientToken = await clientTokenFor(db, secret, projectId);
    await expect(caller().project.linkTeam({ kind: "client", token: clientToken })).resolves.toEqual({ slug: "walk-crew" });
    const payToken = await signPayLink(secret, payment.id);
    await expect(caller().project.linkTeam({ kind: "pay", token: payToken })).resolves.toEqual({ slug: "walk-crew" });
    // A pay token is not a client token, and a changed signature is no token at all.
    await expect(caller().project.linkTeam({ kind: "client", token: payToken })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller().project.linkTeam({ kind: "client", token: `${clientToken.slice(0, -2)}xx` }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
