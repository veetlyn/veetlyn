import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { delivery } from "../schema/projects";
import { createTestDb, hasTestDatabase, seedProject, seedServicesTeamWithAdmin, truncateAll } from "../testing/db";
import {
  findFileUpload,
  insertFileUpload,
  listDeliveryFiles,
  lockFileUploadForAttach,
  markFileUploadAttached,
} from "./files";

describe.skipIf(!hasTestDatabase)("file uploads", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function seedUpload(input: { teamId: string; projectId: string; userId?: string; name?: string }) {
    const fileName = input.name ?? "brand.zip";
    return insertFileUpload(db, {
      teamId: input.teamId,
      projectId: input.projectId,
      purpose: "delivery",
      r2Key: `teams/${input.teamId}/files/${crypto.randomUUID()}`,
      fileName,
      contentType: "application/zip",
      sizeBytes: 5_400_000,
      createdById: input.userId ?? null,
    });
  }

  it("inserts an upload and finds it", async () => {
    const { teamId, userId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });

    const row = await seedUpload({ teamId, projectId, userId });

    expect(row).toMatchObject({ teamId, projectId, purpose: "delivery", sizeBytes: 5_400_000, attachedAt: null });
    expect(await findFileUpload(db, row.id)).toEqual(row);
    expect(await findFileUpload(db, "missing")).toBeNull();
  });

  it("locks an unattached upload only for its own team, project and purpose", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });
    const otherProjectId = await seedProject(db, { teamId, title: "Other" });
    const { teamId: otherTeamId } = await seedServicesTeamWithAdmin(db, { slug: "other" });
    const row = await seedUpload({ teamId, projectId });

    await db.transaction(async (tx) => {
      expect(await lockFileUploadForAttach(tx, { id: row.id, teamId, projectId, purpose: "delivery" })).toEqual(row);
    });
    expect(
      await lockFileUploadForAttach(db, { id: row.id, teamId: otherTeamId, projectId, purpose: "delivery" }),
    ).toBeNull();
    expect(
      await lockFileUploadForAttach(db, { id: row.id, teamId, projectId: otherProjectId, purpose: "delivery" }),
    ).toBeNull();
    expect(await lockFileUploadForAttach(db, { id: "missing", teamId, projectId, purpose: "delivery" })).toBeNull();
  });

  it("marks an upload attached, after which it cannot be locked again", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });
    const row = await seedUpload({ teamId, projectId });

    await markFileUploadAttached(db, row.id);

    expect((await findFileUpload(db, row.id))?.attachedAt).toBeInstanceOf(Date);
    expect(await lockFileUploadForAttach(db, { id: row.id, teamId, projectId, purpose: "delivery" })).toBeNull();
  });

  it("lists the files of the deliveries that have one", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });
    const upload = await seedUpload({ teamId, projectId, name: "Final logo.zip" });
    await db.insert(delivery).values([
      { id: "d1", projectId, teamId, status: "changes_requested", link: "https://example.com" },
      { id: "d2", projectId, teamId, fileUploadId: upload.id },
    ]);

    expect(await listDeliveryFiles(db, ["d1", "d2"])).toEqual([
      { deliveryId: "d2", fileName: "Final logo.zip", sizeBytes: 5_400_000, r2Key: upload.r2Key },
    ]);
    expect(await listDeliveryFiles(db, [])).toEqual([]);
  });

  it("attaches a file to one delivery at most", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId });
    const upload = await seedUpload({ teamId, projectId });
    await db.insert(delivery).values({ projectId, teamId, status: "changes_requested", fileUploadId: upload.id });

    const failure = await db
      .insert(delivery)
      .values({ projectId, teamId, fileUploadId: upload.id })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ cause: { code: "23505", constraint_name: "delivery_fileUploadId_idx" } });
  });
});
