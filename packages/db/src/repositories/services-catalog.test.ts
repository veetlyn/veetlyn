import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { project } from "../schema/projects";
import { servicesDepartment } from "../schema/services-catalog";
import { createTestDb, hasTestDatabase, seedOrganization, seedProject, seedServicesTeam, truncateAll } from "../testing/db";
import {
  countServicesOfferings,
  createServicesDepartment,
  createServicesOffering,
  deleteServicesDepartment,
  deleteServicesOffering,
  findServicesOffering,
  listServicesDepartments,
  listServicesOfferings,
  renameServicesDepartment,
  setServicesOfferingActive,
  updateServicesOffering,
} from "./services-catalog";

const draft = {
  name: "Logo design",
  description: "A logo, two revisions",
  priceMinMinor: 10_000,
  priceMaxMinor: 40_000,
  daysMin: 2,
  daysMax: 5,
  intakeQuestions: ["What is the brand about?"],
};

// The create functions return null on a duplicate name; these tests only use rows the seeds guarantee.
async function must<T>(row: T | null): Promise<T> {
  if (!row) throw new Error("Expected a row");
  return row;
}

describe.skipIf(!hasTestDatabase)("services catalog repository", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("creates departments with increasing positions, trims names, and rejects duplicates per team", async () => {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const labs = await seedServicesTeam(db, { organizationId, slug: "acme-labs" });

    const first = await createServicesDepartment(db, { teamId: studio.id, name: "  Branding  " });
    const second = await createServicesDepartment(db, { teamId: studio.id, name: "Web design" });
    const duplicate = await createServicesDepartment(db, { teamId: studio.id, name: "BRANDING" });
    const otherTeam = await createServicesDepartment(db, { teamId: labs.id, name: "branding" });

    expect(first).toEqual({ id: expect.any(String), name: "Branding", position: 0 });
    expect(second).toEqual({ id: expect.any(String), name: "Web design", position: 1 });
    expect(duplicate).toBeNull();
    expect(otherTeam).toEqual({ id: expect.any(String), name: "branding", position: 0 });
  });

  it("lists departments ordered by position, then name", async () => {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    await seedServicesTeam(db, { organizationId, slug: "acme-labs" });
    const branding = await must(await createServicesDepartment(db, { teamId: studio.id, name: "Branding" }));
    const web = await must(await createServicesDepartment(db, { teamId: studio.id, name: "Web design" }));
    const alpha = await must(await createServicesDepartment(db, { teamId: studio.id, name: "Alpha" }));
    // Same position as Alpha (created directly), so the name breaks the tie.
    await db.insert(servicesDepartment).values({ teamId: studio.id, name: "Beta", position: alpha.position });

    const rows = await listServicesDepartments(db, studio.id);
    expect(rows.map((row) => row.name)).toEqual(["Branding", "Web design", "Alpha", "Beta"]);
    expect(rows[0]).toEqual(branding);
    expect(rows[1]).toEqual(web);
  });

  it("renames departments, but not another team's, and not onto a taken name", async () => {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const labs = await seedServicesTeam(db, { organizationId, slug: "acme-labs" });
    const branding = await must(await createServicesDepartment(db, { teamId: studio.id, name: "Branding" }));
    const web = await must(await createServicesDepartment(db, { teamId: studio.id, name: "Web design" }));
    const other = await must(await createServicesDepartment(db, { teamId: labs.id, name: "Theirs" }));

    await expect(renameServicesDepartment(db, { id: branding.id, teamId: studio.id, name: "Identity" })).resolves.toBe(true);
    await expect(
      renameServicesDepartment(db, { id: web.id, teamId: studio.id, name: "  identity  " }),
    ).resolves.toBe(null);
    await expect(
      renameServicesDepartment(db, { id: other.id, teamId: studio.id, name: "Steal" }),
    ).resolves.toBe(false);
    await expect(listServicesDepartments(db, studio.id)).resolves.toEqual([
      { id: branding.id, name: "Identity", position: 0 },
      { id: web.id, name: "Web design", position: 1 },
    ]);
  });

  it("deletes departments and leaves their offerings ungrouped, but not another team's", async () => {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const labs = await seedServicesTeam(db, { organizationId, slug: "acme-labs" });
    const branding = await must(await createServicesDepartment(db, { teamId: studio.id, name: "Branding" }));
    const other = await must(await createServicesDepartment(db, { teamId: labs.id, name: "Theirs" }));
    const offering = await must(
      await createServicesOffering(db, { teamId: studio.id, departmentId: branding.id, ...draft }),
    );

    await expect(deleteServicesDepartment(db, { id: other.id, teamId: studio.id })).resolves.toBe(false);
    await expect(deleteServicesDepartment(db, { id: branding.id, teamId: studio.id })).resolves.toBe(true);
    await expect(listServicesDepartments(db, studio.id)).resolves.toEqual([]);
    await expect(findServicesOffering(db, { id: offering.id, teamId: studio.id })).resolves.toMatchObject({
      id: offering.id,
      departmentId: null,
    });
  });

  it("creates offerings active with the next position, and rejects duplicate names per team", async () => {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const labs = await seedServicesTeam(db, { organizationId, slug: "acme-labs" });
    const branding = await must(await createServicesDepartment(db, { teamId: studio.id, name: "Branding" }));

    const first = await createServicesOffering(db, { teamId: studio.id, departmentId: branding.id, ...draft });
    const second = await createServicesOffering(db, {
      teamId: studio.id,
      ...draft,
      name: "Website design",
      priceMinMinor: 50_000,
      priceMaxMinor: 90_000,
      daysMin: 7,
      daysMax: 14,
    });
    const duplicate = await createServicesOffering(db, { teamId: studio.id, ...draft, name: "LOGO DESIGN" });
    const otherTeam = await createServicesOffering(db, { teamId: labs.id, ...draft });

    expect(first).toEqual({
      id: expect.any(String),
      departmentId: branding.id,
      active: true,
      position: 0,
      ...draft,
    });
    expect(second).toMatchObject({ name: "Website design", position: 1 });
    expect(duplicate).toBeNull();
    expect(otherTeam).toMatchObject({ name: draft.name, position: 0 });
  });

  it("lists offerings by position with an activeOnly filter, and finds them per team", async () => {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const labs = await seedServicesTeam(db, { organizationId, slug: "acme-labs" });
    const logo = await must(await createServicesOffering(db, { teamId: studio.id, ...draft }));
    const web = await must(await createServicesOffering(db, { teamId: studio.id, ...draft, name: "Website design" }));
    const theirs = await must(await createServicesOffering(db, { teamId: labs.id, ...draft }));
    await setServicesOfferingActive(db, { id: web.id, teamId: studio.id, active: false });

    const rows = await listServicesOfferings(db, studio.id);
    expect(rows.map((row) => row.id)).toEqual([logo.id, web.id]);
    await expect(listServicesOfferings(db, studio.id, { activeOnly: true })).resolves.toEqual([logo]);
    await expect(listServicesOfferings(db, studio.id, { activeOnly: false })).resolves.toEqual(rows);

    await expect(findServicesOffering(db, { id: logo.id, teamId: studio.id })).resolves.toEqual(logo);
    await expect(findServicesOffering(db, { id: theirs.id, teamId: studio.id })).resolves.toBeNull();
    await expect(findServicesOffering(db, { id: "missing", teamId: studio.id })).resolves.toBeNull();
  });

  it("updates offerings, moves them between departments or ungroups them, but not another team's", async () => {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const labs = await seedServicesTeam(db, { organizationId, slug: "acme-labs" });
    const branding = await must(await createServicesDepartment(db, { teamId: studio.id, name: "Branding" }));
    const web = await must(await createServicesDepartment(db, { teamId: studio.id, name: "Web design" }));
    const offering = await must(
      await createServicesOffering(db, { teamId: studio.id, departmentId: branding.id, ...draft }),
    );
    const theirs = await must(await createServicesOffering(db, { teamId: labs.id, ...draft }));
    const other = await must(await createServicesOffering(db, { teamId: studio.id, ...draft, name: "Website design" }));

    const updated = await updateServicesOffering(db, {
      id: offering.id,
      teamId: studio.id,
      departmentId: web.id,
      ...draft,
      name: "Logo refresh",
      description: "A refreshed logo",
      priceMinMinor: 20_000,
      priceMaxMinor: 60_000,
      daysMin: 3,
      daysMax: 7,
      intakeQuestions: ["Who is the audience?"],
    });
    expect(updated).toMatchObject({
      id: offering.id,
      departmentId: web.id,
      name: "Logo refresh",
      description: "A refreshed logo",
      priceMinMinor: 20_000,
      priceMaxMinor: 60_000,
      daysMin: 3,
      daysMax: 7,
      intakeQuestions: ["Who is the audience?"],
    });

    await expect(updateServicesOffering(db, { id: theirs.id, teamId: studio.id, ...draft })).resolves.toBe(null);
    await expect(
      updateServicesOffering(db, { id: other.id, teamId: studio.id, ...draft, name: "Logo refresh" }),
    ).resolves.toBe(null);
    await expect(
      updateServicesOffering(db, { id: offering.id, teamId: studio.id, departmentId: null, ...draft }),
    ).resolves.toMatchObject({ departmentId: null });
  });

  it("sets active only for the team's own offerings", async () => {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const labs = await seedServicesTeam(db, { organizationId, slug: "acme-labs" });
    const offering = await must(await createServicesOffering(db, { teamId: studio.id, ...draft }));
    const theirs = await must(await createServicesOffering(db, { teamId: labs.id, ...draft }));

    await expect(setServicesOfferingActive(db, { id: offering.id, teamId: studio.id, active: false })).resolves.toBe(true);
    await expect(findServicesOffering(db, { id: offering.id, teamId: studio.id })).resolves.toMatchObject({ active: false });
    await expect(setServicesOfferingActive(db, { id: offering.id, teamId: studio.id, active: true })).resolves.toBe(true);
    await expect(setServicesOfferingActive(db, { id: theirs.id, teamId: studio.id, active: false })).resolves.toBe(false);
    await expect(findServicesOffering(db, { id: theirs.id, teamId: labs.id })).resolves.toMatchObject({ active: true });
  });

  it("deletes offerings and unsets the projects that referenced them", async () => {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const labs = await seedServicesTeam(db, { organizationId, slug: "acme-labs" });
    const offering = await must(await createServicesOffering(db, { teamId: studio.id, ...draft }));
    const theirs = await must(await createServicesOffering(db, { teamId: labs.id, ...draft }));
    const projectId = await seedProject(db, { teamId: studio.id });
    await db.update(project).set({ offeringId: offering.id }).where(eq(project.id, projectId));

    await expect(deleteServicesOffering(db, { id: theirs.id, teamId: studio.id })).resolves.toBe(false);
    await expect(deleteServicesOffering(db, { id: offering.id, teamId: studio.id })).resolves.toBe(true);
    await expect(findServicesOffering(db, { id: offering.id, teamId: studio.id })).resolves.toBeNull();
    const [row] = await db
      .select({ offeringId: project.offeringId })
      .from(project)
      .where(eq(project.id, projectId));
    expect(row?.offeringId).toBeNull();
  });

  it("counts offerings, all of them or only the active ones", async () => {
    const { organizationId } = await seedOrganization(db);
    const studio = await seedServicesTeam(db, { organizationId, slug: "acme-studio" });
    const labs = await seedServicesTeam(db, { organizationId, slug: "acme-labs" });
    const logo = await must(await createServicesOffering(db, { teamId: studio.id, ...draft }));
    await createServicesOffering(db, { teamId: studio.id, ...draft, name: "Website design" });
    await createServicesOffering(db, { teamId: studio.id, ...draft, name: "Banner design" });
    await createServicesOffering(db, { teamId: labs.id, ...draft, name: "Theirs" });
    await setServicesOfferingActive(db, { id: logo.id, teamId: studio.id, active: false });

    await expect(countServicesOfferings(db, studio.id)).resolves.toBe(3);
    await expect(countServicesOfferings(db, studio.id, { activeOnly: true })).resolves.toBe(2);
    await expect(countServicesOfferings(db, labs.id)).resolves.toBe(1);
  });
});
