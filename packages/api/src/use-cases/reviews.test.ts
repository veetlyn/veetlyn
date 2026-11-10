import { createTestDb, hasTestDatabase, seedProject, seedServicesTeamWithAdmin, seedClientContact, truncateAll } from "@jendal-workspace/db/testing/db";
import { primaryContactFor } from "@jendal-workspace/db/repositories/contacts";
import { upsertDispute } from "@jendal-workspace/db/repositories/operating-model";
import { findProjectById } from "@jendal-workspace/db/repositories/projects";
import { sellerReview } from "@jendal-workspace/db/schema/reviews";
import { project } from "@jendal-workspace/db/schema/projects";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { addPortfolioItem, rateClient, removePortfolioItem, sellerReputation, submitReview, teamRatingsView } from "./reviews";
import type { ProjectActor } from "./projects";
import { createFakeFileStore } from "@jendal-workspace/core";
import { perform } from "../actions/perform";
import { reviewSubmit } from "../actions/reviews";
import type { Actor } from "../actions/actors";

describe.skipIf(!hasTestDatabase)("reviews and portfolios", () => {
  const db = createTestDb();
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function setup() {
    const { teamId, userId } = await seedServicesTeamWithAdmin(db);
    const projectId = await seedProject(db, { teamId, status: "completed", clientName: "Rita Client" });
    const contact = await primaryContactFor(db, projectId);
    if (!contact) throw new Error("Missing contact");
    const admin: ProjectActor = { teamId, actorId: userId, role: "admin" };
    return { teamId, projectId, contactId: contact.contactId, admin };
  }

  function request(actor: Actor) {
    return {
      deps: { db, platformName: "Platform", files: createFakeFileStore(), auth: { options: { secret: "test-secret-at-least-thirty-two-characters" } } },
      actor,
      surface: "web" as const,
      request: { requestId: crypto.randomUUID(), ip: null },
    };
  }

  it("accepts the client's review through perform, but refuses staff, strangers and another project's client", async () => {
    const f = await setup();
    const input = { projectId: f.projectId, rating: 5, body: "Excellent work" };
    const token = { projectId: f.projectId, contactId: f.contactId };
    await expect(perform(request({ kind: "user", userId: f.admin.actorId }), reviewSubmit, input)).rejects.toThrow();
    const other = await seedServicesTeamWithAdmin(db, { slug: "other" });
    await expect(perform(request({ kind: "user", userId: other.userId }), reviewSubmit, input)).rejects.toThrow();
    await expect(perform(request({ kind: "client_link", token: { ...token, projectId: crypto.randomUUID() } }), reviewSubmit, input)).rejects.toThrow();
    expect(await db.select().from(sellerReview)).toEqual([]);
    await expect(perform(request({ kind: "client_link", token }), reviewSubmit, input)).resolves.toEqual({ rating: 5, body: "Excellent work" });
  });

  it("serializes concurrent reviews so one contact cannot replace another's submission", async () => {
    const f = await setup();
    const second = await seedClientContact(db, { teamId: f.teamId, projectId: f.projectId, name: "Other" });
    const outcomes = await Promise.allSettled([
      submitReview(db, { ...f, rating: 5, body: "First" }),
      submitReview(db, { ...f, contactId: second, rating: 1, body: "Second" }),
    ]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await db.select().from(sellerReview)).toHaveLength(1);
  });

  it("publishes one review per project, masks contact details, and permits its author to edit it", async () => {
    const f = await setup();
    await submitReview(db, { ...f, rating: 5, body: "Great work. rita@example.com" });
    await submitReview(db, { ...f, rating: 4, body: "Good work. rita@example.com" });
    const reputation = await sellerReputation(db, f.teamId);
    expect(reputation.rating).toEqual({ average: 4, count: 1 });
    expect(reputation.reviews).toEqual([expect.objectContaining({ rating: 4, reviewerName: "Rita C." })]);
    expect(reputation.reviews[0]?.body).not.toContain("rita@example.com");
    expect(await db.select().from(sellerReview)).toHaveLength(1);
  });

  it("refuses another attached client editing the original client's review", async () => {
    const f = await setup();
    await submitReview(db, { ...f, rating: 5, body: "Great" });
    const second = await seedClientContact(db, { teamId: f.teamId, projectId: f.projectId, name: "Another client", identities: [] });
    await expect(submitReview(db, { ...f, contactId: second, rating: 1, body: "Changed" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await sellerReputation(db, f.teamId)).rating).toEqual({ average: 5, count: 1 });
  });

  it("refuses unpaid work, detached contacts and open disputes", async () => {
    const f = await setup();
    await db.update(project).set({ status: "awaiting_balance" }).where(eq(project.id, f.projectId));
    await expect(submitReview(db, { ...f, rating: 5, body: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await db.update(project).set({ status: "completed" }).where(eq(project.id, f.projectId));
    await expect(submitReview(db, { ...f, contactId: crypto.randomUUID(), rating: 5, body: "" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await upsertDispute(db, { teamId: f.teamId, projectId: f.projectId, paypalDisputeId: "CASE1", reason: "work", status: "open", amountMinor: 100, currency: "USD" });
    await expect(submitReview(db, { ...f, rating: 5, body: "" })).rejects.toThrow(/open PayPal case/);
    await expect(rateClient(db, f.admin, { projectId: f.projectId, rating: 5, note: "" })).rejects.toThrow(/open PayPal case/);
  });

  it("makes old reviews final and excludes hidden reviews from public counts", async () => {
    const f = await setup();
    await submitReview(db, { ...f, rating: 5, body: "Great" });
    await db.update(sellerReview).set({ createdAt: new Date("2020-01-01"), hiddenAt: new Date() });
    await expect(submitReview(db, { ...f, rating: 1, body: "changed" })).rejects.toThrow(/now final/);
    expect((await sellerReputation(db, f.teamId)).rating).toBeNull();
    expect((await sellerReputation(db, f.teamId)).reviews).toEqual([]);
  });

  it("keeps the team's client rating private from freelancers and permits only admins to write it", async () => {
    const f = await setup();
    const input = { projectId: f.projectId, rating: 4, note: "Clear brief" };
    await rateClient(db, f.admin, input);
    const row = await findProjectById(db, f.projectId);
    if (!row) throw new Error("Missing project");
    expect((await teamRatingsView(db, f.admin, row)).clientRating).toEqual({ rating: 4, note: "Clear brief" });
    const freelancer: ProjectActor = { ...f.admin, role: "freelancer" };
    expect((await teamRatingsView(db, freelancer, row)).clientRating).toBeNull();
    await expect(rateClient(db, freelancer, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const other = await seedServicesTeamWithAdmin(db, { slug: "other" });
    await expect(rateClient(db, { teamId: other.teamId, actorId: other.userId, role: "admin" }, input)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets admins publish and remove their portfolio, not another team's, and refuses unsafe links", async () => {
    const f = await setup();
    const input = { title: "Logo refresh", url: "https://example.com/work", description: "Brand identity" };
    const item = await addPortfolioItem(db, f.admin, input);
    expect((await sellerReputation(db, f.teamId)).portfolio).toEqual([{ ...input, id: item.id }]);
    const other = await seedServicesTeamWithAdmin(db, { slug: "other" });
    await expect(removePortfolioItem(db, { teamId: other.teamId, actorId: other.userId, role: "admin" }, item)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(addPortfolioItem(db, { ...f.admin, role: "freelancer" }, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(addPortfolioItem(db, f.admin, { ...input, url: "javascript:alert(1)" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await removePortfolioItem(db, f.admin, item);
    expect((await sellerReputation(db, f.teamId)).portfolio).toEqual([]);
  });
});
