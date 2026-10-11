import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { relations } from "../relations";
import { fileUpload } from "../schema/files";
import { delivery } from "../schema/projects";
import { createTestDb, hasTestDatabase, seedOrganization, seedProduct, seedProject, seedServicesTeamWithAdmin, seedStore, truncateAll } from "../testing/db";
import {
  deleteOtherAttachedProductFiles,
  findAttachedProductFile,
  findFileUpload,
  insertFileUpload,
  listDeliveryFiles,
  lockFileUploadForAttach,
  lockProductFileUploadForAttach,
  markFileUploadAttached,
  sweepUnattachedUploads,
} from "./files";

describe.skipIf(!hasTestDatabase)("file uploads", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function seedUpload(input: {
    teamId: string;
    projectId: string;
    userId?: string;
    name?: string;
    createdAt?: Date;
    attachedAt?: Date;
  }) {
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
      createdAt: input.createdAt,
      attachedAt: input.attachedAt,
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
      .catch((cause: unknown) => cause);
    expect(failure).toMatchObject({ cause: { code: "23505", constraint_name: "delivery_fileUploadId_idx" } });
  });

  it("locks an unattached product upload and finds the attached file", async () => {
    const { organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "digital-shop" });
    const product = await seedProduct(db, { storeId: store.id, kind: "digital" });
    const row = await insertFileUpload(db, {
      teamId: store.id,
      productId: product.id,
      purpose: "product",
      r2Key: `teams/${store.id}/files/${crypto.randomUUID()}`,
      fileName: "icons.zip",
      contentType: "application/zip",
      sizeBytes: 1_200_000,
    });

    await db.transaction(async (tx) => {
      expect(
        await lockProductFileUploadForAttach(tx, {
          id: row.id,
          teamId: store.id,
          productId: product.id,
          purpose: "product",
        }),
      ).toEqual(row);
    });
    // Nothing is attached yet, so there is no product file to sell.
    expect(await findAttachedProductFile(db, product.id)).toBeNull();

    await markFileUploadAttached(db, row.id);

    await db.transaction(async (tx) => {
      expect(
        await lockProductFileUploadForAttach(tx, {
          id: row.id,
          teamId: store.id,
          productId: product.id,
          purpose: "product",
        }),
      ).toBeNull();
    });
    expect((await findAttachedProductFile(db, product.id))?.id).toBe(row.id);
  });

  it("deletes the other attached files of a product and returns their keys", async () => {
    const { organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "digital-shop" });
    const product = await seedProduct(db, { storeId: store.id, kind: "digital" });
    const otherProduct = await seedProduct(db, { storeId: store.id, kind: "digital", title: "Other pack" });
    const productFile = (productId: string, attached: boolean) =>
      insertFileUpload(db, {
        teamId: store.id,
        productId,
        purpose: "product",
        r2Key: `products/${store.id}/${productId}/${crypto.randomUUID()}`,
        fileName: "icons.zip",
        contentType: "application/zip",
        sizeBytes: 1_200_000,
        attachedAt: attached ? new Date() : undefined,
      });
    const keep = await productFile(product.id, true);
    const oldA = await productFile(product.id, true);
    const oldB = await productFile(product.id, true);
    const pending = await productFile(product.id, false);
    const otherFile = await productFile(otherProduct.id, true);

    const keys = await db.transaction((tx) =>
      deleteOtherAttachedProductFiles(tx, { productId: product.id, keepId: keep.id }),
    );

    expect(keys.toSorted()).toEqual([oldA.r2Key, oldB.r2Key].toSorted());
    const remaining = await db.select({ id: fileUpload.id }).from(fileUpload);
    expect(remaining.map((row) => row.id).toSorted()).toEqual([keep.id, pending.id, otherFile.id].toSorted());
  });

  describe("sweepUnattachedUploads", () => {
    const NOW = new Date("2026-03-01T12:00:00Z");
    const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);
    const cutoff = hoursAgo(24);

    async function seedProjectUploads() {
      const { teamId } = await seedServicesTeamWithAdmin(db);
      const projectId = await seedProject(db, { teamId });
      return {
        teamId,
        projectId,
        older: await seedUpload({ teamId, projectId, createdAt: hoursAgo(72) }),
        old: await seedUpload({ teamId, projectId, createdAt: hoursAgo(48) }),
        attached: await seedUpload({ teamId, projectId, createdAt: hoursAgo(72), attachedAt: hoursAgo(71) }),
        recent: await seedUpload({ teamId, projectId, createdAt: hoursAgo(2) }),
      };
    }

    async function remainingIds() {
      const rows = await db.select({ id: fileUpload.id }).from(fileUpload);
      return rows.map((row) => row.id).sort();
    }

    it("deletes old unattached uploads with their objects, oldest first, up to the limit", async () => {
      const { older, old, attached, recent } = await seedProjectUploads();
      const deleteObjects = vi.fn(async (_keys: string[]) => {});

      expect(await sweepUnattachedUploads(db, { createdBefore: cutoff, limit: 1 }, deleteObjects)).toBe(1);
      expect(deleteObjects).toHaveBeenCalledExactlyOnceWith([older.r2Key]);

      expect(await sweepUnattachedUploads(db, { createdBefore: cutoff, limit: 10 }, deleteObjects)).toBe(1);
      expect(deleteObjects).toHaveBeenLastCalledWith([old.r2Key]);
      expect(await remainingIds()).toEqual([attached.id, recent.id].sort());
    });

    it("does nothing when there is nothing to sweep", async () => {
      const deleteObjects = vi.fn(async (_keys: string[]) => {});

      expect(await sweepUnattachedUploads(db, { createdBefore: cutoff, limit: 10 }, deleteObjects)).toBe(0);
      expect(deleteObjects).not.toHaveBeenCalled();
    });

    it("keeps every row when deleting the objects fails", async () => {
      const { older, old, attached, recent } = await seedProjectUploads();
      const failure = new Error("R2 unavailable");

      await expect(
        sweepUnattachedUploads(db, { createdBefore: cutoff, limit: 10 }, async () => {
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(await remainingIds()).toEqual([older.id, old.id, attached.id, recent.id].sort());
    });

    it("skips an upload a delivery is attaching right now", async () => {
      const { teamId, projectId, older, old } = await seedProjectUploads();
      // lock_timeout makes a sweep that waits for the lock fail fast instead of hanging the test.
      const client = postgres(process.env.TEST_DATABASE_URL ?? "", {
        max: 2,
        fetch_types: false,
        connection: { lock_timeout: 2_000 },
      });
      const { promise: locked, resolve: lockTaken } = Promise.withResolvers<void>();
      const { promise: release, resolve: releaseLock } = Promise.withResolvers<void>();
      try {
        const parallel = drizzle({ client, relations });
        const holder = parallel.transaction(async (tx) => {
          await lockFileUploadForAttach(tx, { id: older.id, teamId, projectId, purpose: "delivery" });
          lockTaken();
          await release;
        });
        holder.catch(() => {});
        await Promise.race([locked, holder]);
        const deleteObjects = vi.fn(async (_keys: string[]) => {});

        const swept = sweepUnattachedUploads(parallel, { createdBefore: cutoff, limit: 10 }, deleteObjects);
        const result = await swept.finally(() => releaseLock());
        await holder;

        expect(result).toBe(1);
        expect(deleteObjects).toHaveBeenCalledExactlyOnceWith([old.r2Key]);
        expect(await findFileUpload(db, older.id)).not.toBeNull();
        expect(await findFileUpload(db, old.id)).toBeNull();
      } finally {
        releaseLock();
        await client.end();
      }
    });
  });
});
