import { createFakeFileStore } from "@jendal-workspace/core";
import { createTestAuth } from "@jendal-workspace/auth/testing";
import {
  createTestDb,
  hasTestDatabase,
  seedOrganization,
  seedProject,
  seedServicesTeam,
  seedServicesTeamMember,
  seedServicesOffering,
  seedStore,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { project } from "@jendal-workspace/db/schema/projects";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { makeSession } from "../testing";
import { createTestCatalogServices } from "../testing/catalog";
import { appRouter } from "./index";

describe.skipIf(!hasTestDatabase)("servicesCatalog router", () => {
  const db = createTestDb();
  const { auth } = createTestAuth(db);

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  const callerFor = (userId: string | null) =>
    appRouter.createCaller({
      db,
      session: userId ? makeSession(userId) : null,
      environment: "sandbox",
      auth,
      headers: new Headers(),
      catalog: createTestCatalogServices(),
      files: createFakeFileStore(),
    });

  type OfferingFields = {
    name: string;
    description: string;
    priceMinMinor: number;
    priceMaxMinor: number;
    daysMin: number;
    daysMax: number;
    intakeQuestions: string[];
  };

  const offering = (overrides: Partial<OfferingFields> = {}): OfferingFields => ({
    name: "Logo design",
    description: "",
    priceMinMinor: 10_000,
    priceMaxMinor: 40_000,
    daysMin: 2,
    daysMax: 5,
    intakeQuestions: [],
    ...overrides,
  });

  it("lists the catalog for every team role, and hides it from outsiders and store slugs", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const managerId = await seedServicesTeamMember(db, { organizationId, teamId: studio.id, role: "manager" });
    const freelancerId = await seedServicesTeamMember(db, { organizationId, teamId: studio.id, role: "freelancer" });
    await seedServicesOffering(db, { teamId: studio.id });
    const outsider = await seedOrganization(db);
    await seedStore(db, { organizationId, slug: "acme" });

    for (const userId of [ownerId, managerId, freelancerId]) {
      const catalog = await callerFor(userId).servicesCatalog.list({ teamSlug: "acme-studio" });
      expect(catalog.departments).toEqual([]);
      expect(catalog.offerings).toHaveLength(1);
      expect(catalog.offerings[0]).toMatchObject({ name: "Logo design", active: true, departmentId: null });
    }

    await expect(callerFor(outsider.userId).servicesCatalog.list({ teamSlug: "acme-studio" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(callerFor(ownerId).servicesCatalog.list({ teamSlug: "acme" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("lets only an admin create departments, trims the name, and refuses empty, long and duplicate names", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const managerId = await seedServicesTeamMember(db, { organizationId, teamId: studio.id, role: "manager" });
    const admin = callerFor(ownerId);

    await expect(
      callerFor(managerId).servicesCatalog.createDepartment({ teamSlug: "acme-studio", name: "Design" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "Only an admin can manage the catalog." });

    const created = await admin.servicesCatalog.createDepartment({ teamSlug: "acme-studio", name: "  Design  " });
    expect(created).toMatchObject({ name: "Design", position: 0 });

    await expect(admin.servicesCatalog.createDepartment({ teamSlug: "acme-studio", name: "   " })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Give the department a name.",
    });
    await expect(
      admin.servicesCatalog.createDepartment({ teamSlug: "acme-studio", name: "x".repeat(61) }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Keep the department name under 60 characters.",
    });
    await expect(admin.servicesCatalog.createDepartment({ teamSlug: "acme-studio", name: "design" })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Your team already has a department with this name.",
    });
  });

  it("renames a department, refuses a taken name, and hides another team's department", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const admin = callerFor(ownerId);

    const department = await admin.servicesCatalog.createDepartment({ teamSlug: "acme-studio", name: "Design" });
    await admin.servicesCatalog.createDepartment({ teamSlug: "acme-studio", name: "Branding" });

    await expect(
      admin.servicesCatalog.renameDepartment({ teamSlug: "acme-studio", departmentId: department.id, name: "  Production  " }),
    ).resolves.toEqual({ departmentId: department.id, name: "Production" });

    await expect(
      admin.servicesCatalog.renameDepartment({ teamSlug: "acme-studio", departmentId: department.id, name: "branding" }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "Your team already has a department with this name." });

    const second = await seedOrganization(db);
    await seedServicesTeam(db, { organizationId: second.organizationId, slug: "other-studio" });
    const foreign = await callerFor(second.userId).servicesCatalog.createDepartment({
      teamSlug: "other-studio",
      name: "Other design",
    });
    expect(foreign).toMatchObject({ name: "Other design" });
    await expect(
      admin.servicesCatalog.renameDepartment({ teamSlug: "acme-studio", departmentId: foreign?.id ?? "", name: "Design" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "This department is not in your team." });
  });

  it("deletes a department and leaves its offerings ungrouped", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const admin = callerFor(ownerId);

    const department = await admin.servicesCatalog.createDepartment({ teamSlug: "acme-studio", name: "Design" });
    const created = await admin.servicesCatalog.createOffering({
      teamSlug: "acme-studio",
      ...offering(),
      departmentId: department?.id ?? null,
    });
    expect(created).toMatchObject({ departmentId: department?.id ?? null });

    await expect(
      admin.servicesCatalog.deleteDepartment({ teamSlug: "acme-studio", departmentId: department?.id ?? "" }),
    ).resolves.toEqual({ departmentId: department?.id });

    const catalog = await admin.servicesCatalog.list({ teamSlug: "acme-studio" });
    expect(catalog.departments).toEqual([]);
    expect(catalog.offerings).toHaveLength(1);
    expect(catalog.offerings[0]).toMatchObject({ departmentId: null, name: "Logo design" });
  });

  it("stores a service with trimmed text, refusing bad ranges, too many questions, duplicates and foreign departments", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const admin = callerFor(ownerId);

    const created = await admin.servicesCatalog.createOffering({
      teamSlug: "acme-studio",
      name: "  Logo design  ",
      description: " A logo for your brand. ",
      priceMinMinor: 10_000,
      priceMaxMinor: 40_000,
      daysMin: 2,
      daysMax: 5,
      intakeQuestions: ["  What is your brand?  "],
      departmentId: null,
    });
    expect(created).toMatchObject({
      name: "Logo design",
      description: "A logo for your brand.",
      intakeQuestions: ["What is your brand?"],
      active: true,
      departmentId: null,
      position: 0,
    });

    await expect(
      admin.servicesCatalog.createOffering({
        teamSlug: "acme-studio",
        ...offering({ name: "Poster design", priceMinMinor: 500, priceMaxMinor: 200 }),
        departmentId: null,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "The top of the range cannot be below its bottom." });

    await expect(
      admin.servicesCatalog.createOffering({
        teamSlug: "acme-studio",
        ...offering({ name: "Poster design", intakeQuestions: ["One?", "Two?", "Three?", "Four?", "Five?", "Six?"] }),
        departmentId: null,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await expect(
      admin.servicesCatalog.createOffering({
        teamSlug: "acme-studio",
        ...offering({ name: "logo design" }),
        departmentId: null,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "Your team already has a service with this name." });

    const second = await seedOrganization(db);
    await seedServicesTeam(db, { organizationId: second.organizationId, slug: "other-studio" });
    const foreign = await callerFor(second.userId).servicesCatalog.createDepartment({
      teamSlug: "other-studio",
      name: "Other design",
    });
    await expect(
      admin.servicesCatalog.createOffering({
        teamSlug: "acme-studio",
        ...offering({ name: "Poster design" }),
        departmentId: foreign?.id ?? null,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "That department is not in your team." });
  });

  it("updates a service, moves it between groups and ungroups it, and hides another team's service", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const admin = callerFor(ownerId);

    const department = await admin.servicesCatalog.createDepartment({ teamSlug: "acme-studio", name: "Design" });
    const created = await admin.servicesCatalog.createOffering({
      teamSlug: "acme-studio",
      ...offering(),
      departmentId: null,
    });

    const updated = await admin.servicesCatalog.updateOffering({
      teamSlug: "acme-studio",
      offeringId: created?.id ?? "",
      ...offering({ name: "  Brand identity  ", description: "A full identity." }),
      departmentId: department?.id ?? null,
    });
    expect(updated).toMatchObject({ id: created?.id, name: "Brand identity", departmentId: department?.id });

    const ungrouped = await admin.servicesCatalog.updateOffering({
      teamSlug: "acme-studio",
      offeringId: created?.id ?? "",
      ...offering({ name: "Brand identity" }),
      departmentId: null,
    });
    expect(ungrouped).toMatchObject({ departmentId: null });

    const second = await seedOrganization(db);
    const otherTeam = await seedServicesTeam(db, { organizationId: second.organizationId, slug: "other-studio" });
    const foreignId = await seedServicesOffering(db, { teamId: otherTeam.id, name: "Other service" });
    await expect(
      admin.servicesCatalog.updateOffering({
        teamSlug: "acme-studio",
        offeringId: foreignId,
        ...offering({ name: "Stolen service" }),
        departmentId: null,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "This service is not in your team." });
  });

  it("flips a service inactive, and the team list still shows it", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const admin = callerFor(ownerId);
    const offeringId = await seedServicesOffering(db, { teamId: studio.id });

    await expect(
      admin.servicesCatalog.setOfferingActive({ teamSlug: "acme-studio", offeringId, active: false }),
    ).resolves.toEqual({ offeringId, active: false });

    const catalog = await admin.servicesCatalog.list({ teamSlug: "acme-studio" });
    expect(catalog.offerings).toHaveLength(1);
    expect(catalog.offerings[0]).toMatchObject({ id: offeringId, active: false });
  });

  it("deletes a service, and a project that referenced it keeps its row", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const admin = callerFor(ownerId);
    const offeringId = await seedServicesOffering(db, { teamId: studio.id });
    const projectId = await seedProject(db, { teamId: studio.id });
    await db.update(project).set({ offeringId }).where(eq(project.id, projectId));

    await expect(admin.servicesCatalog.deleteOffering({ teamSlug: "acme-studio", offeringId })).resolves.toEqual({
      offeringId,
    });

    const [row] = await db.select().from(project).where(eq(project.id, projectId));
    expect(row?.offeringId).toBeNull();

    const catalog = await admin.servicesCatalog.list({ teamSlug: "acme-studio" });
    expect(catalog.offerings).toEqual([]);
  });

  it("keeps one team's catalog invisible to another", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    await seedServicesOffering(db, { teamId: studio.id });
    expect((await callerFor(ownerId).servicesCatalog.list({ teamSlug: "acme-studio" })).offerings).toHaveLength(1);

    const second = await seedOrganization(db);
    await seedServicesTeam(db, { organizationId: second.organizationId, slug: "other-studio" });
    const other = await callerFor(second.userId).servicesCatalog.list({ teamSlug: "other-studio" });
    expect(other.departments).toEqual([]);
    expect(other.offerings).toEqual([]);
  });

  it("lists a service in AI assistants by default, and an edit without the flag keeps the admin's opt-out", async () => {
    const { userId: ownerId, organizationId } = await seedOrganization(db);
    await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const owner = callerFor(ownerId);
    const created = await owner.servicesCatalog.createOffering({ teamSlug: "acme-studio", ...offering() });
    expect(created.listed).toBe(true);
    await owner.servicesCatalog.updateOffering({ teamSlug: "acme-studio", offeringId: created.id, ...offering(), listed: false });
    const renamed = await owner.servicesCatalog.updateOffering({
      teamSlug: "acme-studio",
      offeringId: created.id,
      ...offering({ name: "Logo refresh" }),
    });
    expect(renamed.listed).toBe(false);

    const department = await owner.servicesCatalog.createDepartment({ teamSlug: "acme-studio", name: "Brand" });
    await owner.servicesCatalog.setDepartmentListed({ teamSlug: "acme-studio", departmentId: department.id, listed: false });
    const { departments } = await owner.servicesCatalog.list({ teamSlug: "acme-studio" });
    expect(departments).toEqual([expect.objectContaining({ id: department.id, listed: false })]);
  });
});
