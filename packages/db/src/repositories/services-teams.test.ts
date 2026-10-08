import { defaultServicesTeamSettings, soloServicesTeamSettings } from "@jendal-workspace/core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  addMember,
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedServicesTeam,
  seedStore,
  seedUser,
  truncateAll,
} from "../testing/db";
import {
  addServicesTeamMember,
  applySoloTeamDefaults,
  createServicesTeamSettings,
  findServicesTeamBySlug,
  findUserByEmail,
  getServicesTeamSettings,
  listOrganizationsWithServicesTeams,
  listServicesTeamMembers,
  saveServicesTeamBio,
  saveServicesTeamSettings,
  servicesTeamRoleFor,
  setServicesTeamMemberRole,
  setServicesTeamMemberTitle,
  switchToTeam,
  workspaceRoleFor,
} from "./services-teams";

describe.skipIf(!hasTestDatabase)("services team repository", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("finds a services team by slug, but not a store", async () => {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio", name: "Acme Studio" });
    await seedStore(db, { organizationId, slug: "acme" });

    expect(studio).toEqual({
      id: expect.any(String),
      organizationId,
      slug: "acme-studio",
      name: "Acme Studio",
      paypalMerchantId: null,
    });
    await expect(findServicesTeamBySlug(db, "acme-studio")).resolves.toEqual(studio);
    await expect(findServicesTeamBySlug(db, "acme")).resolves.toBeNull();
    await expect(findServicesTeamBySlug(db, "missing")).resolves.toBeNull();
  });

  it("reads the default settings, and creating them twice changes nothing", async () => {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });

    await createServicesTeamSettings(db, studio.id);

    await expect(getServicesTeamSettings(db, studio.id)).resolves.toEqual(defaultServicesTeamSettings(studio.id));
    await expect(getServicesTeamSettings(db, "missing")).resolves.toBeNull();
  });

  it("saves settings and records when, even without a settings row", async () => {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio", withSettings: false });
    const input = {
      currency: "EUR",
      teamCutBps: 2000,
      managementFeeBps: 500,
      quotingMode: "open",
      payoutMode: "rules",
    } as const;

    const saved = await saveServicesTeamSettings(db, studio.id, input);

    expect(saved).toEqual({
      teamId: studio.id,
      solo: false,
      storeEnabled: false,
      bio: "",
      ...input,
      settingsSavedAt: expect.any(Date),
      discordGuildId: null,
    });
    await expect(getServicesTeamSettings(db, studio.id)).resolves.toEqual(saved);
    const again = await saveServicesTeamSettings(db, studio.id, { ...input, teamCutBps: 2500 });
    expect(again.teamCutBps).toBe(2500);
  });

  it("applies the solo defaults right after create, without marking the rates saved", async () => {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio", withSettings: false });

    await applySoloTeamDefaults(db, studio.id);

    await expect(getServicesTeamSettings(db, studio.id)).resolves.toEqual(soloServicesTeamSettings(studio.id));
  });

  it("saves the bio without touching the rates or the setup checklist", async () => {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });

    await saveServicesTeamBio(db, studio.id, "We design logos.");

    await expect(getServicesTeamSettings(db, studio.id)).resolves.toEqual({
      ...defaultServicesTeamSettings(studio.id),
      bio: "We design logos.",
    });
  });

  it("switches a solo seller to a team, restoring the team rates it never changed", async () => {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio", solo: true });

    await switchToTeam(db, studio.id);

    await expect(getServicesTeamSettings(db, studio.id)).resolves.toEqual(defaultServicesTeamSettings(studio.id));
  });

  it("keeps the rates a solo seller changed when it becomes a team, but asks the team to confirm them", async () => {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio", solo: true });
    await saveServicesTeamSettings(db, studio.id, {
      currency: "USD",
      teamCutBps: 2000,
      managementFeeBps: 500,
      quotingMode: "assigned",
      payoutMode: "manual",
    });
    expect((await getServicesTeamSettings(db, studio.id))?.settingsSavedAt).toBeInstanceOf(Date);

    await switchToTeam(db, studio.id);

    await expect(getServicesTeamSettings(db, studio.id)).resolves.toMatchObject({
      solo: false,
      teamCutBps: 2000,
      managementFeeBps: 500,
      settingsSavedAt: null,
    });
  });

  it("makes workspace owners and admins team admins, and reads other members' team roles", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const adminId = await addMember(db, { organizationId, role: "admin" });
    const managerId = await addMember(db, { organizationId, role: "member" });
    const plainMemberId = await addMember(db, { organizationId, role: "member" });
    const outsider = await seedOrganization(db);
    await addServicesTeamMember(db, { teamId: studio.id, userId: managerId, role: "manager" });

    await expect(servicesTeamRoleFor(db, studio.id, ownerId)).resolves.toBe("admin");
    await expect(servicesTeamRoleFor(db, studio.id, adminId)).resolves.toBe("admin");
    await expect(servicesTeamRoleFor(db, studio.id, managerId)).resolves.toBe("manager");
    await expect(servicesTeamRoleFor(db, studio.id, plainMemberId)).resolves.toBeNull();
    await expect(servicesTeamRoleFor(db, studio.id, outsider.userId)).resolves.toBeNull();
  });

  it("gives no services team role on a store", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const store = await seedStore(db, { organizationId, slug: "acme" });

    await expect(servicesTeamRoleFor(db, store.id, userId)).resolves.toBeNull();
  });

  it("reads a user's workspace role", async () => {
    const { userId, organizationId } = await seedOrganization(db);
    const outsiderId = await seedUser(db);

    await expect(workspaceRoleFor(db, organizationId, userId)).resolves.toBe("owner");
    await expect(workspaceRoleFor(db, organizationId, outsiderId)).resolves.toBeNull();
  });

  it("finds users by email whatever the case and spacing", async () => {
    const id = await seedUser(db, "Bea");

    await expect(findUserByEmail(db, ` ${id.toUpperCase()}@EXAMPLE.COM `)).resolves.toEqual({
      id,
      name: "Bea",
      email: `${id}@example.com`,
    });
    await expect(findUserByEmail(db, "nobody@example.com")).resolves.toBeNull();
  });

  it("lists workspace admins and team members by name, without other workspace members", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const zoeId = await addMember(db, { organizationId, role: "member", name: "Zoe" });
    const bobId = await addMember(db, { organizationId, role: "member", name: "Bob" });
    await addMember(db, { organizationId, role: "member", name: "Carl" });
    await addServicesTeamMember(db, { teamId: studio.id, userId: zoeId, role: "freelancer" });
    await addServicesTeamMember(db, { teamId: studio.id, userId: bobId, role: "manager" });

    await expect(listServicesTeamMembers(db, studio)).resolves.toEqual([
      {
        userId: bobId,
        name: "Bob",
        email: `${bobId}@example.com`,
        role: "manager",
        title: null,
        workspaceAdmin: false,
      },
      {
        userId: ownerId,
        name: "Owner",
        email: `${ownerId}@example.com`,
        role: "admin",
        title: null,
        workspaceAdmin: true,
      },
      {
        userId: zoeId,
        name: "Zoe",
        email: `${zoeId}@example.com`,
        role: "freelancer",
        title: null,
        workspaceAdmin: false,
      },
    ]);
  });

  it("stores and clears member titles, and refuses a user with no row", async () => {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const userId = await addMember(db, { organizationId, role: "member" });
    const strangerId = await seedUser(db);
    await addServicesTeamMember(db, { teamId: studio.id, userId, role: "freelancer" });

    await expect(
      setServicesTeamMemberTitle(db, { teamId: studio.id, userId, title: "Brand designer" }),
    ).resolves.toBe(true);
    await expect(listServicesTeamMembers(db, studio)).resolves.toEqual([
      expect.objectContaining({ role: "admin", workspaceAdmin: true }),
      expect.objectContaining({ userId, role: "freelancer", title: "Brand designer" }),
    ]);

    await expect(setServicesTeamMemberTitle(db, { teamId: studio.id, userId, title: null })).resolves.toBe(true);
    await expect(listServicesTeamMembers(db, studio)).resolves.toEqual([
      expect.objectContaining({ role: "admin", workspaceAdmin: true }),
      expect.objectContaining({ userId, title: null }),
    ]);

    await expect(
      setServicesTeamMemberTitle(db, { teamId: studio.id, userId: strangerId, title: "Designer" }),
    ).resolves.toBe(false);
  });

  it("adds a member once and changes the role of members only", async () => {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const userId = await addMember(db, { organizationId, role: "member" });
    const strangerId = await seedUser(db);

    await expect(addServicesTeamMember(db, { teamId: studio.id, userId, role: "freelancer" })).resolves.toBe(true);
    await expect(addServicesTeamMember(db, { teamId: studio.id, userId, role: "manager" })).resolves.toBe(false);
    await expect(setServicesTeamMemberRole(db, { teamId: studio.id, userId, role: "manager" })).resolves.toBe(true);
    await expect(servicesTeamRoleFor(db, studio.id, userId)).resolves.toBe("manager");
    await expect(
      setServicesTeamMemberRole(db, { teamId: studio.id, userId: strangerId, role: "admin" }),
    ).resolves.toBe(false);
  });

  it("lists the services teams each user can open, per organization", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db, { name: "Acme Inc" });
    await seedStore(db, { organizationId, slug: "acme" });
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio", name: "Acme Studio" });
    const labs = await seedServicesTeam(db, { organizationId, slug: "acme-labs", name: "Acme Labs" });
    const freelancerId = await addMember(db, { organizationId, role: "member" });
    await addServicesTeamMember(db, { teamId: studio.id, userId: freelancerId, role: "freelancer" });
    const empty = await seedOrganization(db, { name: "Beta LLC" });

    await expect(listOrganizationsWithServicesTeams(db, ownerId)).resolves.toEqual([
      {
        organization: { id: organizationId, name: "Acme Inc" },
        role: "owner",
        servicesTeams: [
          { team: labs, role: "admin" },
          { team: studio, role: "admin" },
        ],
      },
    ]);
    await expect(listOrganizationsWithServicesTeams(db, freelancerId)).resolves.toEqual([
      {
        organization: { id: organizationId, name: "Acme Inc" },
        role: "member",
        servicesTeams: [{ team: studio, role: "freelancer" }],
      },
    ]);
    await expect(listOrganizationsWithServicesTeams(db, empty.userId)).resolves.toEqual([
      { organization: { id: empty.organizationId, name: "Beta LLC" }, role: "owner", servicesTeams: [] },
    ]);
  });
});
