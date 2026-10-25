import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { recordRulebookAcceptance } from "@jendal-workspace/db/repositories/operating-model";
import { createServicesOffering } from "@jendal-workspace/db/repositories/services-catalog";
import { memberMark, rulebookAcceptance } from "@jendal-workspace/db/schema/operating-model";
import { outbox } from "@jendal-workspace/db/schema/outbox";
import { team as teamTable } from "@jendal-workspace/db/schema/organization";
import { project as projectTable } from "@jendal-workspace/db/schema/projects";
import { servicesTeamSettings } from "@jendal-workspace/db/schema/services-teams";
import {
  createTestDb,
  hasTestDatabase,
  seedProject,
  seedServicesTeamMember,
  seedServicesTeamWithAdmin,
  truncateAll,
} from "@jendal-workspace/db/testing/db";
import { COLLECTIVE_RULEBOOK_SPEC, formatCompactRuleSummary, AGENCY_RULEBOOK_SPEC } from "@opmodel/engine-rules";

import { searchOfferings } from "../use-cases/offerings";
import { startProject } from "../use-cases/projects";
import { requestQuote } from "../use-cases/requests";
import {
  acceptMemberRulebook,
  getTeamRulebookState,
  giveMemberLeavingNotice,
  publishRulebook,
  publishedClientTerms,
  saveRulebookDraft,
  setMemberNoticePreference,
} from "../use-cases/rulebooks";

describe.skipIf(!hasTestDatabase)("rulebook use cases", () => {
  const db = createTestDb();

  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  it("seeds a published v1 rulebook from the team's kind and shows the terms", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    await db.update(servicesTeamSettings).set({ kind: "collective", teamCutBps: 1000 }).where(eq(servicesTeamSettings.teamId, teamId));

    const state = await getTeamRulebookState(db, { teamId, currency: "USD" });
    expect(state.published).toMatchObject({ version: 1, preset: "collective" });
    expect(state.published.rules).toEqual(COLLECTIVE_RULEBOOK_SPEC.rules);
    expect(state.summaries.compact).toBe(formatCompactRuleSummary(COLLECTIVE_RULEBOOK_SPEC.rules, "USD"));
    expect(state.memberAccepted).toBeNull();

    const terms = await publishedClientTerms(db, { teamId, currency: "USD" });
    expect(terms.terms).toContain("upfront");
    expect(terms.rulebookId).toBe(state.published.id);
  });

  it("pins rules and split defaults through both creation paths without changing existing projects on publish", async () => {
    const { teamId, userId } = await seedServicesTeamWithAdmin(db);
    await db.update(teamTable).set({ status: "active" }).where(eq(teamTable.id, teamId));
    const v1State = await getTeamRulebookState(db, { teamId, currency: "USD" });
    const create = async (suffix: string) => [
      await startProject(db, { teamId, actorId: userId, role: "admin" }, { title: "Logo design", clientEmail: `admin-${suffix}@example.com` }),
      await requestQuote(db, { slug: "team", offeringId: null, name: "Client", email: `client-${suffix}@example.com`, description: "Design a bakery logo", answers: [], termsAccepted: true, acceptedRulebookId: (await publishedClientTerms(db, { teamId, currency: "USD" })).rulebookId }),
    ];
    const before = await create("before");
    const snapshots = await Promise.all(before.map(async ({ projectId }) => {
      const [row] = await db.select().from(projectTable).where(eq(projectTable.id, projectId));
      expect(row).toMatchObject({ rulebookId: v1State.published.id, revisions: v1State.published.rules.revisions.freeCount, upfrontBps: v1State.published.rules.upfront.defaultBps, managerCutBps: v1State.published.rules.split.managerCutBps });
      return row;
    }));

    await saveRulebookDraft(db, {
      teamId,
      userId,
      preset: "custom",
      spec: { ...AGENCY_RULEBOOK_SPEC.rules, upfront: { defaultBps: 3000 }, revisions: { freeCount: 4, paidRevisionPriceMinor: 9000 }, split: { teamCutBps: 2500, managerCutBps: 1000, memberCutBps: 6500 } },
    });
    const v2 = await publishRulebook(db, { teamId, userId });

    const state = await getTeamRulebookState(db, { teamId, currency: "USD" });
    expect(state.published.version).toBe(v2.version);
    for (const snapshot of snapshots) {
      if (!snapshot) throw new Error("Missing created project");
      const [pinned] = await db.select().from(projectTable).where(eq(projectTable.id, snapshot.id));
      expect(pinned).toEqual(snapshot);
    }
    for (const { projectId } of await create("after")) {
      const [pinned] = await db.select().from(projectTable).where(eq(projectTable.id, projectId));
      expect(pinned).toMatchObject({ teamId, rulebookId: state.published.id, revisions: 4, upfrontBps: 3000, teamCutBps: 2500, managerCutBps: 1000 });
    }
    const [settings] = await db.select().from(servicesTeamSettings).where(eq(servicesTeamSettings.teamId, teamId));
    expect(settings).toMatchObject({ teamCutBps: 2500, managerCutBps: 1000 });
  });

  it("records member agreement acceptance and answers the query", async () => {
    const { teamId, organizationId } = await seedServicesTeamWithAdmin(db);
    const memberId = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });

    const before = await getTeamRulebookState(db, { teamId, currency: "USD", userId: memberId });
    expect(before.memberAccepted).toBe(false);

    const accepted = await acceptMemberRulebook(db, { teamId, userId: memberId });
    expect(accepted.version).toBe(1);

    const after = await getTeamRulebookState(db, { teamId, currency: "USD", userId: memberId });
    expect(after.memberAccepted).toBe(true);
  });

  it("toggles the member notice preference", async () => {
    const { teamId, organizationId } = await seedServicesTeamWithAdmin(db);
    const memberId = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });

    expect((await getTeamRulebookState(db, { teamId, currency: "USD", userId: memberId })).projectNoticesEnabled).toBe(true);
    await setMemberNoticePreference(db, { teamId, userId: memberId, projectNoticesEnabled: false });
    expect((await getTeamRulebookState(db, { teamId, currency: "USD", userId: memberId })).projectNoticesEnabled).toBe(false);
  });

  it("records a leaving notice with its effective date and outbox event", async () => {
    const { teamId, organizationId } = await seedServicesTeamWithAdmin(db);
    const state = await getTeamRulebookState(db, { teamId, currency: "USD" });
    const memberId = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    const now = new Date("2026-10-01T00:00:00Z");

    const { effectiveAt } = await giveMemberLeavingNotice(db, { teamId, userId: memberId, rulebook: state.published.rules, now: () => now });
    expect(effectiveAt.getTime() - now.getTime()).toBe(state.published.rules.leavingNotice.days * 86_400_000);

    const [event] = await db.select().from(outbox).where(eq(outbox.type, "member.leaving_notice"));
    expect(event).toMatchObject({ teamId, projectId: null });
  });

  it("rolls back a leaving restriction when its durable notice cannot be written", async () => {
    const { teamId, organizationId } = await seedServicesTeamWithAdmin(db);
    const memberId = await seedServicesTeamMember(db, { organizationId, teamId, role: "freelancer" });
    await db.execute(sql`alter table outbox add constraint reject_leaving_notice check (type <> 'member.leaving_notice')`);
    try {
      await expect(giveMemberLeavingNotice(db, { teamId, userId: memberId, rulebook: { leavingNotice: { days: 14 } } })).rejects.toThrow();
      expect(await db.select().from(memberMark).where(eq(memberMark.teamId, teamId))).toEqual([]);
    } finally {
      await db.execute(sql`alter table outbox drop constraint reject_leaving_notice`);
    }
  });

  it("accepts and returns offering fulfilment through the public search", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    // The public search lists active teams only.
    await db.update(teamTable).set({ status: "active" }).where(eq(teamTable.id, teamId));
    const created = await createServicesOffering(db, {
      teamId,
      name: "Logo design",
      description: "",
      priceMinMinor: 10_000,
      priceMaxMinor: 40_000,
      daysMin: 2,
      daysMax: 5,
      intakeQuestions: [],
      fulfilment: "both",
    });
    expect(created).toMatchObject({ fulfilment: "both" });

    const results = await searchOfferings(db, { query: "logo" });
    expect(results.find((row) => row.id === created?.id)).toMatchObject({ fulfilment: "both" });
  });

  it("records a client acceptance tied to the project", async () => {
    const { teamId } = await seedServicesTeamWithAdmin(db);
    const state = await getTeamRulebookState(db, { teamId, currency: "USD" });
    const projectId = await seedProject(db, { teamId });

    await recordRulebookAcceptance(db, { rulebookId: state.published.id, teamId, actorKind: "client", contactId: null, projectId });
    const rows = await db.select().from(rulebookAcceptance);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorKind: "client", projectId });
  });
});
