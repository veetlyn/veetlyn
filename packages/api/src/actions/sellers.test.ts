import { createTestAuth } from "@jendal-workspace/auth/testing";
import { createFakeFileStore } from "@jendal-workspace/core";
import { teamMember } from "@jendal-workspace/db/schema/organization";
import {
  addMember,
  createTestDb,
  hasTestDatabase,
  seedOrder,
  seedOrganization,
  seedProduct,
  seedServicesTeam,
  seedServicesTeamMember,
  seedStore,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { Actor } from "./actors";
import { type ActionDeps, perform } from "./perform";
import { orderList, productList, workspaceListMine, workspaceSummary } from "./sellers";

describe.skipIf(!hasTestDatabase)("seller and workspace reads", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);
  const deps: ActionDeps = { db, platformName: "Platform", files: createFakeFileStore(), auth };
  const request = { requestId: "req-1", ip: null };
  const person = (userId: string): Actor => ({ kind: "agent", agentId: "dash-assistant", onBehalfOf: { kind: "user", userId } });
  const at = (userId: string, place: { team?: { id: string }; workspace?: { id: string } } = {}) => ({
    deps,
    actor: person(userId),
    surface: "agent" as const,
    request,
    ...place,
  });

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  // A workspace with a services team and a store; the owner, a store's staff, and a plain member.
  async function workspace() {
    const { userId: ownerId, organizationId } = await seedOrganization(db, { role: "owner", name: "Studio" });
    const { id: teamId } = await seedServicesTeam(db, { organizationId, slug: "walk-crew" });
    const store = await seedStore(db, { organizationId, slug: "clay-room", name: "Clay Room" });
    const staffId = await addMember(db, { organizationId, role: "member" });
    await db.insert(teamMember).values({ id: crypto.randomUUID(), teamId: store.id, userId: staffId, createdAt: new Date() });
    const memberId = await addMember(db, { organizationId, role: "member" });
    return { ownerId, organizationId, teamId, store, staffId, memberId };
  }

  it("lists each person's workspaces with only the sellers they may open", async () => {
    const { ownerId, staffId, memberId } = await workspace();
    const sellersOf = async (userId: string) =>
      (await perform(at(userId), workspaceListMine, {})).flatMap((w) => w.sellers.map((s) => `${s.kind}:${s.slug}:${s.role}`));

    expect(await sellersOf(ownerId)).toEqual(["services team:walk-crew:admin", "store:clay-room:admin"]);
    expect(await sellersOf(staffId)).toEqual(["store:clay-room:staff"]);
    expect(await sellersOf(memberId)).toEqual([]);
  });

  it("summarizes the call's workspace for its members, with the plan for owners only", async () => {
    const { ownerId, organizationId, memberId } = await workspace();
    const { userId: strangerId } = await seedOrganization(db);
    const here = { workspace: { id: organizationId } };

    await expect(perform(at(ownerId, here), workspaceSummary, {})).resolves.toMatchObject({ name: "Studio", role: "owner" });
    await expect(perform(at(memberId, here), workspaceSummary, {})).resolves.toMatchObject({ role: "member", sellers: [], plan: null });
    await expect(perform(at(strangerId, here), workspaceSummary, {})).rejects.toMatchObject({ code: "not_found", message: "Workspace not found." });
  });

  it("lets a store's staff read its products and orders, and nobody outside it", async () => {
    const { store, staffId, memberId } = await workspace();
    const product = await seedProduct(db, { storeId: store.id, title: "Glazing kit", status: "published", priceMinor: 2900 });
    await seedOrder(db, { teamId: store.id, productId: product.id, status: "paid", amountMinor: 2900 });
    const inStore = { team: { id: store.id } };

    await expect(perform(at(staffId, inStore), productList, {})).resolves.toEqual([
      expect.objectContaining({ title: "Glazing kit", status: "published", priceLow: 2900, priceHigh: 2900 }),
    ]);
    await expect(perform(at(staffId, inStore), orderList, {})).resolves.toEqual([
      expect.objectContaining({ amountMinor: 2900, status: "paid", buyerEmail: "buyer@example.com" }),
    ]);
    await expect(perform(at(memberId, inStore), productList, {})).rejects.toMatchObject({ code: "not_found" });
  });

  it("keeps a services team's orders to its admins", async () => {
    const { organizationId, teamId } = await workspace();
    const freelancerId = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });

    await expect(perform(at(freelancerId, { team: { id: teamId } }), orderList, {})).rejects.toMatchObject({ code: "forbidden" });
    await expect(perform(at(freelancerId, { team: { id: teamId } }), productList, {})).rejects.toMatchObject({ code: "forbidden" });
  });
});
