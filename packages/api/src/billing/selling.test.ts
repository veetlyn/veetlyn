import { applySubscriptionSnapshot, ensureBillingAccount } from "@jendal-workspace/db/repositories/billing";
import { ensurePublishedRulebook } from "@jendal-workspace/db/repositories/operating-model";
import { findProjectById } from "@jendal-workspace/db/repositories/projects";
import { fileUpload } from "@jendal-workspace/db/schema/files";
import { payment, project, quote } from "@jendal-workspace/db/schema/projects";
import { createTestDb, hasTestDatabase, seedProject, seedServicesTeam, seedServicesTeamWithAdmin, truncateAll } from "@jendal-workspace/db/testing/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { acceptQuote, addQuote, assignFreelancer } from "../use-cases/projects";
import { requireStorageFor } from "./entitlements";
import { acceptMemberRulebook } from "../use-cases/rulebooks";

const DAY = 86_400_000;

// Billing design §6: a lapsed workspace takes no new sale. Accepting a quote commits the client to a deposit, so it
// is refused there, with words that never mention the seller's billing.
describe.skipIf(!hasTestDatabase)("selling and the workspace plan", () => {
  const db = createTestDb();
  beforeEach(() => truncateAll(db));
  afterAll(() => db.$client.end());

  async function quotedProject(trialStartedDaysAgo: number) {
    const { userId, organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    await ensureBillingAccount(db, { organizationId, product: "services", solo: false, now: new Date(Date.now() - trialStartedDaysAgo * DAY) });
    const rulebook = await ensurePublishedRulebook(db, teamId);
    await acceptMemberRulebook(db, { teamId, userId, termsAccepted: true, acceptedRulebookId: rulebook.id });
    const projectId = await seedProject(db, { teamId });
    await db.update(project).set({ rulebookId: rulebook.id }).where(eq(project.id, projectId));
    const actor = { teamId, actorId: userId, role: "admin" } as const;
    await assignFreelancer(db, actor, { projectId, freelancerId: userId });
    const { quoteId } = await addQuote(db, actor, {
      projectId, freelancerId: userId, deliveryDays: 3, items: [{ description: "Logo", amountMinor: 10_000, extraDays: 0 }],
    });
    return { organizationId, projectId, quoteId };
  }

  it("still sells in the 2 days after the trial", async () => {
    const { projectId, quoteId } = await quotedProject(15);
    await acceptQuote(db, { projectId, quoteId });
    expect((await findProjectById(db, projectId))?.status).toBe("awaiting_deposit");
  });

  it("refuses a lapsed workspace's quote without changing anything, and sells again once it subscribes", async () => {
    const { organizationId, projectId, quoteId } = await quotedProject(17);
    await expect(acceptQuote(db, { projectId, quoteId })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "This seller is not taking payments right now.",
    });
    expect((await findProjectById(db, projectId))?.status).toBe("quoting");
    expect(await db.select().from(payment)).toEqual([]);
    expect(await db.select({ status: quote.status }).from(quote)).toEqual([{ status: "proposed" }]);

    await applySubscriptionSnapshot(db, {
      organizationId, servicesTier: "team", storeTier: null, interval: "monthly", customerId: "cus_1", subscriptionId: "sub_1",
      productId: "prod_1", status: "active", pastDueAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, endsAt: null,
      modifiedAt: new Date(),
    });
    await acceptQuote(db, { projectId, quoteId });
    expect(await db.select().from(payment)).toHaveLength(1);
  });

  it("refuses an upload that would take the workspace past its plan's storage, counting every team", async () => {
    const { organizationId, teamId } = await seedServicesTeamWithAdmin(db);
    await ensureBillingAccount(db, { organizationId, product: "services", solo: true, now: new Date() });
    const sibling = await seedServicesTeam(db, { organizationId, slug: "sibling" });
    // Solo includes 5 GB; 4.9 GB already sits on the other team.
    await db.insert(fileUpload).values({
      teamId: sibling.id, purpose: "delivery", r2Key: "k1", fileName: "a.zip", contentType: "application/zip", sizeBytes: 4_900_000_000,
    });
    await requireStorageFor(db, teamId, 100_000_000);
    await expect(requireStorageFor(db, teamId, 100_000_001)).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "This workspace's plan includes 5 GB of files. Change the plan on the Billing page to add more.",
    });
  });
});
