import { defaultServicesTeamSettings, createFakeFileStore } from "@jendal-workspace/core";
import { createTestAuth, signUpVerified } from "@jendal-workspace/auth/testing";
import { addServicesTeamMember } from "@jendal-workspace/db/repositories/services-teams";
import {
  addMember,
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedProduct,
  seedServicesTeam,
  seedStore,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { user } from "@jendal-workspace/db/schema/auth";
import { billingAccount } from "@jendal-workspace/db/schema/billing";
import { member, team } from "@jendal-workspace/db/schema/organization";
import { AGENCY_RULEBOOK_SPEC } from "@opmodel/engine-rules";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { makeSession } from "../testing";
import { createTestCatalogServices } from "../testing/catalog";
import { appRouter } from "./index";

describe.skipIf(!hasTestDatabase)("servicesTeam router", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  const callerFor = (userId: string | null) =>
    appRouter.createCaller({
      db,
      session: userId ? makeSession(userId) : null,
      environment: "sandbox",
      platformName: "Platform",
      auth,
      headers: new Headers(),
      catalog: createTestCatalogServices(),
      files: createFakeFileStore(),
    });

  async function signedInCaller(email: string) {
    const { headers } = await signUpVerified(auth, db, email);
    const session = await auth.api.getSession({ headers });
    return appRouter.createCaller({
      db,
      session,
      environment: "sandbox",
      platformName: "Platform",
      auth,
      headers,
      catalog: createTestCatalogServices(),
      files: createFakeFileStore(),
    });
  }

  it("rejects anonymous callers", async () => {
    await expect(callerFor(null).servicesTeam.listMine()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      callerFor(null).servicesTeam.create({ name: "Acme Studio", slug: "acme-studio" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("creates a services team in the owner's organization, with default settings and the creator's support email", async () => {
    const caller = await signedInCaller("owner@example.com");

    await expect(caller.servicesTeam.create({ name: "Acme Studio", slug: " Acme-Studio " })).resolves.toEqual({
      slug: "acme-studio",
    });

    const [row] = await db.select().from(team).where(eq(team.slug, "acme-studio"));
    expect(row).toMatchObject({ product: "services", supportEmail: "owner@example.com", paypalMerchantId: null });

    const mine = await caller.servicesTeam.listMine();
    expect(mine).toHaveLength(1);
    expect(mine[0]?.servicesTeams[0]).toMatchObject({ slug: "acme-studio", name: "Acme Studio", role: "admin" });

    const got = await caller.servicesTeam.get({ teamSlug: "acme-studio" });
    expect(got.settings).toMatchObject(defaultServicesTeamSettings(row?.id ?? ""));
  });

  it("creates a solo seller in a workspace of its own, with the solo rates and the creator's support email", async () => {
    const caller = await signedInCaller("owner@example.com");
    await caller.servicesTeam.create({ name: "Acme Studio", slug: "acme-studio" });

    await expect(caller.servicesTeam.create({ name: "Acme Solo", slug: "acme-solo", solo: true })).resolves.toEqual({
      slug: "acme-solo",
    });

    const [row] = await db.select().from(team).where(eq(team.slug, "acme-solo"));
    expect(row).toMatchObject({ product: "services", supportEmail: "owner@example.com" });
    const [studio] = await db.select().from(team).where(eq(team.slug, "acme-studio"));
    expect(row?.organizationId).not.toBe(studio?.organizationId);
    const soloMembers = await db.select().from(member).where(eq(member.organizationId, row?.organizationId ?? ""));
    expect(soloMembers).toHaveLength(1);

    const got = await caller.servicesTeam.get({ teamSlug: "acme-solo" });
    expect(got.settings).toMatchObject({ solo: true, kind: "solo", teamCutBps: 10_000, managementFeeBps: 0, settingsSavedAt: null });

    // The first rulebook comes from the solo preset: no late refunds or strikes, and the seller keeps the price.
    const rules = await caller.rules.state({ teamSlug: "acme-solo" });
    expect(rules.published.preset).toBe("solo");
    expect(rules.published.rules).toMatchObject({
      lateDelivery: { ratePerDayBps: 0, capBps: 0 },
      strikes: { threshold: 0 },
      split: { teamCutBps: 10_000, managerCutBps: 0, memberCutBps: 0 },
    });

    // Like Slack workspaces: each new seller gets a workspace, trial and plan of its own.
    await caller.servicesTeam.create({ name: "Zed Studio", slug: "zed-studio" });
    await caller.store.create({ name: "Acme Shop", slug: "acme-shop" });
    const later = await db.select().from(team).where(inArray(team.slug, ["zed-studio", "acme-shop"]));
    expect(new Set([studio?.organizationId, row?.organizationId, ...later.map((t) => t.organizationId)]).size).toBe(4);
    expect(await db.select().from(billingAccount)).toHaveLength(4);
  });

  it("adds sellers to a named workspace within its plan, and only for its owners and admins", async () => {
    const caller = await signedInCaller("agency@example.com");
    await caller.servicesTeam.create({ name: "Team 1", slug: "team-1" });
    const [first] = await db.select().from(team).where(eq(team.slug, "team-1"));
    const organizationId = first?.organizationId ?? "";

    // The Team plan includes one services team; the trial adds a store as a bundle, and one store is the limit.
    await expect(caller.servicesTeam.create({ name: "Team 2", slug: "team-2", organizationId })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "This workspace's plan includes 1 services team. Change the plan on the Billing page to add another.",
    });
    await caller.store.create({ name: "Acme Shop", slug: "acme-shop-1", organizationId });
    await expect(caller.store.create({ name: "Acme Shop 2", slug: "acme-shop-2", organizationId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.select().from(billingAccount)).toEqual([expect.objectContaining({ organizationId, servicesTier: "team", storeTier: "starter" })]);

    // Agency runs five.
    await db.update(billingAccount).set({ servicesTier: "agency" }).where(eq(billingAccount.organizationId, organizationId));
    for (const n of [2, 3, 4, 5]) await caller.servicesTeam.create({ name: `Team ${n}`, slug: `team-${n}`, organizationId });
    await expect(caller.servicesTeam.create({ name: "Team 6", slug: "team-6", organizationId })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Solo sellers keep a workspace of their own; outsiders and plain members cannot add to one.
    await expect(caller.servicesTeam.create({ name: "Me", slug: "me", solo: true, organizationId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const outsider = await signedInCaller("outsider@example.com");
    await expect(outsider.store.create({ name: "Mine", slug: "mine", organizationId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const memberId = await addMember(db, { organizationId, role: "member" });
    await expect(callerFor(memberId).store.create({ name: "Mine", slug: "mine", organizationId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.select().from(team).where(eq(team.organizationId, organizationId))).toHaveLength(6);
  });

  it("lets only admins save the bio, trims it, and refuses 281 characters", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const managerId = await addMember(db, { organizationId, role: "member" });
    await addServicesTeamMember(db, { teamId: studio.id, userId: managerId, role: "manager" });

    await expect(
      callerFor(managerId).servicesTeam.updateBio({ teamSlug: "acme-studio", bio: "We design logos." }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "Only an admin can change the team settings." });

    const ownerCaller = callerFor(ownerId);
    await expect(ownerCaller.servicesTeam.updateBio({ teamSlug: "acme-studio", bio: "  We design logos.  " })).resolves.toEqual({
      bio: "We design logos.",
    });
    await expect(
      ownerCaller.servicesTeam.updateBio({ teamSlug: "acme-studio", bio: "x".repeat(281) }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Keep your bio under 280 characters.",
    });

    const got = await ownerCaller.servicesTeam.get({ teamSlug: "acme-studio" });
    expect(got.settings?.bio).toBe("We design logos.");
  });

  it("lets only an admin turn the store on and off", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const managerId = await addMember(db, { organizationId, role: "member" });
    await addServicesTeamMember(db, { teamId: studio.id, userId: managerId, role: "manager" });

    await expect(
      callerFor(managerId).servicesTeam.setStoreEnabled({ teamSlug: "acme-studio", enabled: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "Only an admin can change the team settings." });

    const owner = callerFor(ownerId);
    await expect(
      owner.servicesTeam.setStoreEnabled({ teamSlug: "acme-studio", enabled: true }),
    ).resolves.toEqual({ storeEnabled: true });
    expect((await owner.servicesTeam.get({ teamSlug: "acme-studio" })).settings?.storeEnabled).toBe(true);

    await expect(
      owner.servicesTeam.setStoreEnabled({ teamSlug: "acme-studio", enabled: false }),
    ).resolves.toEqual({ storeEnabled: false });
    expect((await owner.servicesTeam.get({ teamSlug: "acme-studio" })).settings?.storeEnabled).toBe(false);
  });

  it("reports the digital product count in get", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    await seedProduct(db, { storeId: studio.id, kind: "digital", title: "Icons" });
    await seedProduct(db, { storeId: studio.id, kind: "digital", title: "Fonts" });
    await seedProduct(db, { storeId: studio.id, kind: "physical", title: "Mug" });

    const got = await callerFor(ownerId).servicesTeam.get({ teamSlug: "acme-studio" });
    expect(got.productCount).toBe(2);
  });

  it("lets only an admin switch a solo seller to a team, restoring the team rates", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    const solo = await seedServicesTeam(db, { organizationId, slug: "acme-solo", solo: true });
    await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const managerId = await addMember(db, { organizationId, role: "member" });
    await addServicesTeamMember(db, { teamId: solo.id, userId: managerId, role: "manager" });

    await expect(
      callerFor(managerId).servicesTeam.switchToTeam({ teamSlug: "acme-solo" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "Only an admin can change the team settings." });
    await expect(callerFor(ownerId).servicesTeam.switchToTeam({ teamSlug: "acme-studio" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This seller is already a team.",
    });

    const switched = await callerFor(ownerId).servicesTeam.switchToTeam({ teamSlug: "acme-solo" });
    expect(switched).toMatchObject({ solo: false, kind: "agency", teamCutBps: 1500, managementFeeBps: 1000 });
    expect(switched?.settingsSavedAt).toBeNull();
  });

  it("keeps a solo seller's rulebook split on the solo rates whatever preset it saves", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    await seedServicesTeam(db, { organizationId, slug: "acme-solo", solo: true });
    const caller = callerFor(userId);

    await caller.rules.saveDraft({ teamSlug: "acme-solo", preset: "agency", rules: AGENCY_RULEBOOK_SPEC.rules });
    await caller.rules.publish({ teamSlug: "acme-solo" });

    const rules = await caller.rules.state({ teamSlug: "acme-solo" });
    expect(rules.published.rules.split).toEqual({ teamCutBps: 10_000, managerCutBps: 0, memberCutBps: 0 });
    const got = await caller.servicesTeam.get({ teamSlug: "acme-solo" });
    expect(got.settings).toMatchObject({ teamCutBps: 10_000, managerCutBps: 0 });
  });

  it("keeps a solo seller on the solo rates when it saves its settings", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    await seedServicesTeam(db, { organizationId, slug: "acme-solo", solo: true });
    const caller = callerFor(userId);

    await expect(
      caller.servicesTeam.updateSettings({
        teamSlug: "acme-solo",
        currency: "USD",
        teamCutBps: 1500,
        managementFeeBps: 1000,
        quotingMode: "assigned",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "A solo seller keeps the whole price. Switch to a team to set a team cut and a management fee.",
    });

    const saved = await caller.servicesTeam.updateSettings({
      teamSlug: "acme-solo",
      currency: "EUR",
      teamCutBps: 10_000,
      managementFeeBps: 0,
      quotingMode: "team",
    });
    expect(saved).toMatchObject({
      currency: "EUR",
      teamCutBps: 10_000,
      managementFeeBps: 0,
      quotingMode: "team",
    });
  });

  it("lets only an admin set a member title, and lists it", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const bea = await addMember(db, { organizationId, role: "member", name: "Bea" });
    await addServicesTeamMember(db, { teamId: studio.id, userId: bea, role: "freelancer" });
    const managerId = await addMember(db, { organizationId, role: "member" });
    await addServicesTeamMember(db, { teamId: studio.id, userId: managerId, role: "manager" });

    await expect(
      callerFor(managerId).servicesTeam.setMemberTitle({ teamSlug: "acme-studio", userId: bea, title: "Designer" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "Only an admin can manage members." });

    const ownerCaller = callerFor(ownerId);
    await expect(
      ownerCaller.servicesTeam.setMemberTitle({ teamSlug: "acme-studio", userId: bea, title: "  Brand designer  " }),
    ).resolves.toEqual({ userId: bea, title: "Brand designer" });

    const members = await ownerCaller.servicesTeam.listMembers({ teamSlug: "acme-studio" });
    expect(members.find((m) => m.userId === bea)).toMatchObject({ title: "Brand designer" });

    await expect(
      ownerCaller.servicesTeam.setMemberTitle({ teamSlug: "acme-studio", userId: "no-such-user", title: "" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "This user is not on the team." });
  });

  it("shares the slug namespace with stores", async () => {
    const { organizationId } = await seedOrganization(db);
    await seedStore(db, { organizationId, slug: "acme" });
    const caller = await signedInCaller("second@example.com");

    const membersBefore = await db.select().from(member);

    await expect(caller.servicesTeam.create({ name: "Acme", slug: "acme" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "This team address is already taken.",
    });
    // A solo retry on a taken address must not leave a new empty workspace behind each time.
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(caller.servicesTeam.create({ name: "Acme", slug: "acme", solo: true })).rejects.toMatchObject({
        code: "CONFLICT",
        message: "This team address is already taken.",
      });
    }
    expect(await db.select().from(member)).toHaveLength(membersBefore.length);
    await expect(caller.servicesTeam.create({ name: "Acme", slug: "login" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This team address is reserved.",
    });
  });

  it("returns a team and its defaults to an admin, as not found to outsiders and to store slugs", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const { product: _product, ...studio } = await seedServicesTeam(db, {
      organizationId,
      slug: "acme-studio",
      name: "Acme Studio",
    });
    await seedStore(db, { organizationId, slug: "acme" });
    const outsider = await seedOrganization(db);

    await expect(callerFor(userId).servicesTeam.get({ teamSlug: " ACME-STUDIO " })).resolves.toEqual({
      team: studio,
      role: "admin",
      settings: { ...defaultServicesTeamSettings(studio.id), settingsSavedAt: null },
      offeringCount: 0,
      productCount: 0,
      payoutCredentialsSaved: false,
    });
    await expect(callerFor(outsider.userId).servicesTeam.get({ teamSlug: "acme-studio" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Team not found.",
    });
    await expect(callerFor(userId).servicesTeam.get({ teamSlug: "acme" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets only admins save the settings, and records when", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const managerId = await addMember(db, { organizationId, role: "member" });
    await addServicesTeamMember(db, { teamId: studio.id, userId: managerId, role: "manager" });

    const input = {
      teamSlug: "acme-studio",
      currency: "EUR",
      teamCutBps: 2000,
      managementFeeBps: 500,
      quotingMode: "team",
    } as const;

    await expect(callerFor(managerId).servicesTeam.updateSettings(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Only an admin can change the team settings.",
    });

    const ownerCaller = callerFor(ownerId);
    const saved = await ownerCaller.servicesTeam.updateSettings(input);
    expect(saved).toMatchObject({ currency: "EUR", teamCutBps: 2000, quotingMode: "team" });
    expect(saved.settingsSavedAt).toEqual(expect.any(String));

    const fetched = await ownerCaller.servicesTeam.get({ teamSlug: "acme-studio" });
    expect(fetched.settings?.settingsSavedAt).toBe(saved.settingsSavedAt);
  });

  it("rejects rates above 100%", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    await seedServicesTeam(db, { organizationId, slug: "acme-studio" });

    await expect(
      callerFor(userId).servicesTeam.updateSettings({
        teamSlug: "acme-studio",
        currency: "USD",
        teamCutBps: 10_001,
        managementFeeBps: 1000,
        quotingMode: "assigned",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("holds the workspace to its plan's members, counting each person once across its services teams", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const other = await seedServicesTeam(db, { organizationId, slug: "acme-other" });
    // The Team plan's trial includes 10: the owner plus nine on the other team.
    const crew: string[] = [];
    for (let n = 0; n < 9; n++) {
      const userId = await addMember(db, { organizationId, role: "member" });
      await addServicesTeamMember(db, { teamId: other.id, userId, role: "freelancer" });
      crew.push(userId);
    }
    const [already] = await db.select({ email: user.email }).from(user).where(eq(user.id, crew[0] ?? ""));
    await expect(
      callerFor(ownerId).servicesTeam.addMember({ teamSlug: "acme-studio", email: already?.email ?? "", role: "freelancer" }),
    ).resolves.toMatchObject({ userId: crew[0] });

    await signUpVerified(auth, db, "eleventh@example.com", "Eleven");
    await expect(
      callerFor(ownerId).servicesTeam.addMember({ teamSlug: "acme-studio", email: "eleventh@example.com", role: "freelancer" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "This workspace's plan includes 10 members. Change the plan on the Billing page to add more.",
    });
    expect(await callerFor(ownerId).servicesTeam.listMembers({ teamSlug: studio.slug })).toHaveLength(2);
  });

  it("refuses to add a member to a solo seller", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    await seedServicesTeam(db, { organizationId, slug: "acme-solo", solo: true });
    await signUpVerified(auth, db, "bea@example.com", "Bea");

    await expect(
      callerFor(ownerId).servicesTeam.addMember({ teamSlug: "acme-solo", email: "bea@example.com", role: "freelancer" }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "A solo seller has no members. Switch to a team first.",
    });
    await expect(callerFor(ownerId).servicesTeam.listMembers({ teamSlug: "acme-solo" })).resolves.toHaveLength(1);
  });

  it("lists members, adds an existing user by email, and keeps workspace admins marked", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const admin = callerFor(ownerId);

    await expect(admin.servicesTeam.listMembers({ teamSlug: "acme-studio" })).resolves.toEqual([
      expect.objectContaining({ userId: ownerId, role: "admin", workspaceAdmin: true }),
    ]);

    const added = await signUpVerified(auth, db, "bea@example.com", "Bea");
    await expect(
      admin.servicesTeam.addMember({ teamSlug: "acme-studio", email: " BEA@EXAMPLE.COM ", role: "freelancer" }),
    ).resolves.toEqual({ userId: added.userId, name: "Bea", email: "bea@example.com", role: "freelancer" });

    await expect(admin.servicesTeam.listMembers({ teamSlug: "acme-studio" })).resolves.toHaveLength(2);

    // A second add is a conflict, and an unknown email a not found.
    await expect(
      admin.servicesTeam.addMember({ teamSlug: "acme-studio", email: "bea@example.com", role: "manager" }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "This user is already on the team." });
    await expect(
      admin.servicesTeam.addMember({ teamSlug: "acme-studio", email: "nobody@example.com", role: "manager" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "No account uses this email. Ask them to sign up first.",
    });

    // Roles change for team members, not for workspace admins.
    await expect(
      admin.servicesTeam.setMemberRole({ teamSlug: "acme-studio", userId: added.userId, role: "manager" }),
    ).resolves.toEqual({ userId: added.userId, role: "manager" });
    await expect(
      admin.servicesTeam.setMemberRole({ teamSlug: "acme-studio", userId: ownerId, role: "manager" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // A freelancer cannot manage members.
    await admin.servicesTeam.setMemberRole({ teamSlug: "acme-studio", userId: added.userId, role: "freelancer" });
    const beaCaller = callerFor(added.userId);
    await expect(beaCaller.servicesTeam.listMembers({ teamSlug: "acme-studio" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Only managers and admins can see the member list.",
    });
    await expect(
      beaCaller.servicesTeam.addMember({ teamSlug: "acme-studio", email: "x@example.com", role: "admin" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
