import { createFakeFileStore } from "@jendal-workspace/core";
import { createTestAuth } from "@jendal-workspace/auth/testing";
import {
  addMember,
  addTeamMember,
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedProduct,
  seedServicesOffering,
  seedServicesTeam,
  seedServicesTeamMember,
  seedStore,
  seedUser,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { setServicesTeamStoreEnabled } from "@jendal-workspace/db/repositories/services-teams";
import { products } from "@jendal-workspace/db/schema/catalog";
import { team } from "@jendal-workspace/db/schema/organization";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Context } from "../context";
import { makeSession } from "../testing";
import { createTestCatalogServices } from "../testing/catalog";
import { appRouter } from "./index";

describe.skipIf(!hasTestDatabase)("seller router", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  const callerFor = (userId: string, onTeamStatusChanged?: Context["onTeamStatusChanged"]) =>
    appRouter.createCaller({
      db,
      session: makeSession(userId),
      environment: "sandbox",
      auth,
      headers: new Headers(),
      catalog: createTestCatalogServices(),
      files: createFakeFileStore(),
      onTeamStatusChanged,
    });

  const connectPaypal = (teamId: string) =>
    db.update(team).set({ paypalMerchantId: "MERCHANT1" }).where(eq(team.id, teamId));

  const addProduct = (storeId: string, status: "draft" | "published") =>
    db.insert(products).values({ storeId, status, title: "Mug" });

  const statusOf = async (teamId: string) => {
    const [row] = await db.select({ status: team.status }).from(team).where(eq(team.id, teamId));
    return row?.status;
  };

  async function servicesSeller(status: "draft" | "active" | "suspended" = "draft") {
    const { userId: adminId, organizationId } = await seedOrganization(db);
    const row = await seedServicesTeam(db, { organizationId, slug: "acme-studio", status });
    const managerId = await seedServicesTeamMember(db, { organizationId, teamId: row.id, role: "manager" });
    const freelancerId = await seedServicesTeamMember(db, { organizationId, teamId: row.id, role: "freelancer" });
    return { adminId, managerId, freelancerId, organizationId, teamId: row.id };
  }

  async function storeSeller(status: "draft" | "active" | "suspended" = "draft") {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    const row = await seedStore(db, { organizationId, slug: "acme-shop", status });
    const orgAdminId = await addMember(db, { organizationId, role: "admin" });
    const teamMemberId = await addMember(db, { organizationId, role: "member" });
    await addTeamMember(db, { teamId: row.id, userId: teamMemberId });
    const plainMemberId = await addMember(db, { organizationId, role: "member" });
    return { ownerId, orgAdminId, teamMemberId, plainMemberId, organizationId, storeId: row.id };
  }

  const notFound = { code: "NOT_FOUND", message: "Seller not found." };

  describe("access", () => {
    it("reports an unknown slug, an outsider and a store member off the store's team as not found", async () => {
      await servicesSeller();
      const { plainMemberId } = await storeSeller();
      const outsiderId = await seedUser(db, "Outsider");

      for (const [userId, teamSlug] of [
        [outsiderId, "nobody-here"],
        [outsiderId, "acme-studio"],
        [outsiderId, "acme-shop"],
        [plainMemberId, "acme-shop"],
      ] as const) {
        const caller = callerFor(userId);
        await expect(caller.seller.status({ teamSlug })).rejects.toMatchObject(notFound);
        await expect(caller.seller.preview({ teamSlug })).rejects.toMatchObject(notFound);
        await expect(caller.seller.publish({ teamSlug })).rejects.toMatchObject(notFound);
        await expect(caller.seller.unpublish({ teamSlug })).rejects.toMatchObject(notFound);
      }
    });

    it("reports a services team as not found to a plain workspace member with no team role", async () => {
      const { organizationId } = await servicesSeller();
      const memberId = await addMember(db, { organizationId, role: "member" });
      await expect(callerFor(memberId).seller.status({ teamSlug: "acme-studio" })).rejects.toMatchObject(notFound);
    });

    it("lets a freelancer read status and preview but not publish", async () => {
      const { freelancerId } = await servicesSeller();
      const caller = callerFor(freelancerId);
      await expect(caller.seller.status({ teamSlug: "acme-studio" })).resolves.toMatchObject({ canManage: false });
      await expect(caller.seller.preview({ teamSlug: "acme-studio" })).resolves.toMatchObject({ slug: "acme-studio" });
      await expect(caller.seller.publish({ teamSlug: "acme-studio" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("status", () => {
    it("counts a services team's active services and reports the publish problem", async () => {
      const { adminId, managerId, freelancerId, teamId } = await servicesSeller();
      await seedServicesOffering(db, { teamId });
      await seedServicesOffering(db, { teamId, name: "Hidden", active: false });

      await expect(callerFor(adminId).seller.status({ teamSlug: " Acme-Studio " })).resolves.toEqual({
        product: "services",
        status: "draft",
        listedCount: 1,
        problem: "Connect PayPal before you publish.",
        canManage: true,
      });
      await expect(callerFor(managerId).seller.status({ teamSlug: "acme-studio" })).resolves.toMatchObject({
        canManage: false,
      });
      await expect(callerFor(freelancerId).seller.status({ teamSlug: "acme-studio" })).resolves.toMatchObject({
        canManage: false,
      });

      await connectPaypal(teamId);
      await expect(callerFor(adminId).seller.status({ teamSlug: "acme-studio" })).resolves.toMatchObject({
        problem: null,
      });
    });

    it("counts a store's published products; org owners and admins manage, team members do not", async () => {
      const { ownerId, orgAdminId, teamMemberId, storeId } = await storeSeller();
      await connectPaypal(storeId);
      await addProduct(storeId, "draft");

      await expect(callerFor(ownerId).seller.status({ teamSlug: "acme-shop" })).resolves.toEqual({
        product: "store",
        status: "draft",
        listedCount: 0,
        problem: "Publish at least one product before you publish your store.",
        canManage: true,
      });

      await addProduct(storeId, "published");
      await expect(callerFor(orgAdminId).seller.status({ teamSlug: "acme-shop" })).resolves.toMatchObject({
        listedCount: 1,
        problem: null,
        canManage: true,
      });
      await expect(callerFor(teamMemberId).seller.status({ teamSlug: "acme-shop" })).resolves.toMatchObject({
        canManage: false,
      });
    });
  });

  describe("preview", () => {
    it("returns the seller page for any member, whatever the status", async () => {
      const { managerId, teamId } = await servicesSeller("draft");
      await seedServicesOffering(db, { teamId, name: "Logo design" });
      await seedServicesOffering(db, { teamId, name: "Hidden", active: false });

      const page = await callerFor(managerId).seller.preview({ teamSlug: "acme-studio" });
      expect(page).toMatchObject({ slug: "acme-studio", product: "services", status: "draft" });
      expect(page.offerings.map((o) => o.name)).toEqual(["Logo design"]);

      const { teamMemberId } = await storeSeller("suspended");
      await expect(callerFor(teamMemberId).seller.preview({ teamSlug: "acme-shop" })).resolves.toMatchObject({
        slug: "acme-shop",
        product: "store",
        status: "suspended",
      });
    });
  });

  describe("publish", () => {
    it("refuses a non-admin", async () => {
      const { managerId, teamId } = await servicesSeller();
      await connectPaypal(teamId);
      await seedServicesOffering(db, { teamId });
      const { teamMemberId } = await storeSeller();
      const onTeamStatusChanged = vi.fn();

      const forbidden = { code: "FORBIDDEN", message: "Only an admin can publish or unpublish." };
      await expect(
        callerFor(managerId, onTeamStatusChanged).seller.publish({ teamSlug: "acme-studio" }),
      ).rejects.toMatchObject(forbidden);
      await expect(
        callerFor(teamMemberId, onTeamStatusChanged).seller.publish({ teamSlug: "acme-shop" }),
      ).rejects.toMatchObject(forbidden);
      expect(await statusOf(teamId)).toBe("draft");
      expect(onTeamStatusChanged).not.toHaveBeenCalled();
    });

    it("refuses a services team without PayPal or without an active service", async () => {
      const { adminId, teamId } = await servicesSeller();
      const onTeamStatusChanged = vi.fn();
      const caller = callerFor(adminId, onTeamStatusChanged);
      await seedServicesOffering(db, { teamId });

      await expect(caller.seller.publish({ teamSlug: "acme-studio" })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Connect PayPal before you publish.",
      });

      const { adminId: otherAdminId, teamId: otherTeamId } = await (async () => {
        const { userId, organizationId } = await seedOrganization(db);
        const row = await seedServicesTeam(db, { organizationId, slug: "solo-studio" });
        return { adminId: userId, teamId: row.id };
      })();
      await connectPaypal(otherTeamId);
      await seedServicesOffering(db, { teamId: otherTeamId, active: false });
      await expect(
        callerFor(otherAdminId, onTeamStatusChanged).seller.publish({ teamSlug: "solo-studio" }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Add at least one active service or product before you publish.",
      });
      expect(await statusOf(teamId)).toBe("draft");
      expect(await statusOf(otherTeamId)).toBe("draft");
      expect(onTeamStatusChanged).not.toHaveBeenCalled();
    });

    it("publishes a services team with a published digital product instead of a service, while its store is on", async () => {
      const { adminId, teamId } = await servicesSeller();
      await connectPaypal(teamId);
      await seedProduct(db, { storeId: teamId, kind: "digital", status: "published", priceMinor: 900 });
      const onTeamStatusChanged = vi.fn();

      await expect(
        callerFor(adminId, onTeamStatusChanged).seller.publish({ teamSlug: "acme-studio" }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Add at least one active service or product before you publish.",
      });
      expect(await statusOf(teamId)).toBe("draft");

      await setServicesTeamStoreEnabled(db, teamId, true);
      await expect(
        callerFor(adminId, onTeamStatusChanged).seller.publish({ teamSlug: "acme-studio" }),
      ).resolves.toEqual({ status: "active" });
      expect(await statusOf(teamId)).toBe("active");
      expect(onTeamStatusChanged).toHaveBeenCalledWith({ id: teamId, slug: "acme-studio" });
    });

    it("refuses a services team whose only digital product is a draft", async () => {
      const { adminId, teamId } = await servicesSeller();
      await connectPaypal(teamId);
      await seedProduct(db, { storeId: teamId, kind: "digital", status: "draft", priceMinor: 900 });
      const onTeamStatusChanged = vi.fn();

      await expect(
        callerFor(adminId, onTeamStatusChanged).seller.publish({ teamSlug: "acme-studio" }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Add at least one active service or product before you publish.",
      });
      expect(await statusOf(teamId)).toBe("draft");
      expect(onTeamStatusChanged).not.toHaveBeenCalled();
    });

    it("refuses a store with no published product", async () => {
      const { ownerId, storeId } = await storeSeller();
      await connectPaypal(storeId);
      await addProduct(storeId, "draft");
      const onTeamStatusChanged = vi.fn();
      await expect(
        callerFor(ownerId, onTeamStatusChanged).seller.publish({ teamSlug: "acme-shop" }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Publish at least one product before you publish your store.",
      });
      expect(await statusOf(storeId)).toBe("draft");
      expect(onTeamStatusChanged).not.toHaveBeenCalled();
    });

    it("publishes a ready services team and drops its lookups; publishing again is fine", async () => {
      const { adminId, teamId } = await servicesSeller();
      await connectPaypal(teamId);
      await seedServicesOffering(db, { teamId });
      const onTeamStatusChanged = vi.fn();
      const caller = callerFor(adminId, onTeamStatusChanged);

      await expect(caller.seller.publish({ teamSlug: "acme-studio" })).resolves.toEqual({ status: "active" });
      expect(await statusOf(teamId)).toBe("active");
      expect(onTeamStatusChanged).toHaveBeenCalledWith({ id: teamId, slug: "acme-studio" });

      await expect(caller.seller.publish({ teamSlug: "acme-studio" })).resolves.toEqual({ status: "active" });
      expect(await statusOf(teamId)).toBe("active");
    });

    it("publishes a ready store for an org admin", async () => {
      const { orgAdminId, storeId } = await storeSeller();
      await connectPaypal(storeId);
      await addProduct(storeId, "published");
      const onTeamStatusChanged = vi.fn();

      await expect(
        callerFor(orgAdminId, onTeamStatusChanged).seller.publish({ teamSlug: "acme-shop" }),
      ).resolves.toEqual({ status: "active" });
      expect(await statusOf(storeId)).toBe("active");
      expect(onTeamStatusChanged).toHaveBeenCalledWith({ id: storeId, slug: "acme-shop" });
    });
  });

  describe("unpublish", () => {
    it("is admin-only", async () => {
      const { managerId, freelancerId, teamId } = await servicesSeller("active");
      const onTeamStatusChanged = vi.fn();
      const forbidden = { code: "FORBIDDEN", message: "Only an admin can publish or unpublish." };
      await expect(
        callerFor(managerId, onTeamStatusChanged).seller.unpublish({ teamSlug: "acme-studio" }),
      ).rejects.toMatchObject(forbidden);
      await expect(
        callerFor(freelancerId, onTeamStatusChanged).seller.unpublish({ teamSlug: "acme-studio" }),
      ).rejects.toMatchObject(forbidden);
      expect(await statusOf(teamId)).toBe("active");
      expect(onTeamStatusChanged).not.toHaveBeenCalled();
    });

    it("sets the seller back to draft and drops its lookups", async () => {
      const { ownerId, storeId } = await storeSeller("active");
      const onTeamStatusChanged = vi.fn();

      await expect(
        callerFor(ownerId, onTeamStatusChanged).seller.unpublish({ teamSlug: "acme-shop" }),
      ).resolves.toEqual({ status: "draft" });
      expect(await statusOf(storeId)).toBe("draft");
      expect(onTeamStatusChanged).toHaveBeenCalledWith({ id: storeId, slug: "acme-shop" });
    });
  });

  it("refuses to publish or unpublish a suspended seller", async () => {
    const { adminId, teamId } = await servicesSeller("suspended");
    await connectPaypal(teamId);
    await seedServicesOffering(db, { teamId });
    const onTeamStatusChanged = vi.fn();
    const caller = callerFor(adminId, onTeamStatusChanged);
    const suspended = { code: "BAD_REQUEST", message: "This seller is suspended. Contact support@payleor.com." };

    await expect(caller.seller.publish({ teamSlug: "acme-studio" })).rejects.toMatchObject(suspended);
    await expect(caller.seller.unpublish({ teamSlug: "acme-studio" })).rejects.toMatchObject(suspended);
    expect(await statusOf(teamId)).toBe("suspended");
    expect(onTeamStatusChanged).not.toHaveBeenCalled();
  });
});
