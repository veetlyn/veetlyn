import {
  amendmentEffect,
  amendmentProblemMessage,
  amendQuoteItems,
  balanceDue,
  canAssignFreelancer,
  canProposeAmendment,
  canServicesTeam,
  canStartProject,
  canSubmitDelivery,
  checkUploadFile,
  completionPostings,
  completionRefundId,
  depositDue,
  finalPriceMinor,
  formatMoney,
  managementFeeCreditTransfer,
  money,
  paymentLines,
  quoteAuthor,
  quoteAuthorRefusalMessage,
  quoteItemsProblem,
  quoteItemsProblemMessage,
  quoteTotalMinor,
  transitionProject,
  transitionRefusalMessage,
  type ProjectEvent,
  type ProjectFacts,
  type ProjectStatus,
  type QuoteItemDraft,
  type FileStore,
  type ServicesTeamRole,
} from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { DbExecutor, Transaction } from "@jendal-workspace/db/executor";
import { attachContact, matchOrCreateContact } from "@jendal-workspace/db/repositories/contacts";
import { insertEventMessage, userDisplayName } from "@jendal-workspace/db/repositories/conversations";
import {
  findProjectById,
  getCurrentQuote,
  getProjectFacts,
  type DeliveryRow,
  type ProjectRow,
  type QuoteWithItems,
} from "@jendal-workspace/db/repositories/projects";
import {
  findFileUpload,
  insertFileUpload,
  lockFileUploadForAttach,
  markFileUploadAttached,
} from "@jendal-workspace/db/repositories/files";
import { createProjectRefund } from "@jendal-workspace/db/repositories/project-refunds";
import { countMemberMarks, ensurePublishedRulebook, lockMemberWork, memberAcceptedRulebook, memberHasLeavingNotice, pauseProjectSchedule, projectHasOpenDispute, recordMemberMark, upsertPendingScheduleItems } from "@jendal-workspace/db/repositories/operating-model";
import { hitRequestLimit } from "@jendal-workspace/db/repositories/request-limits";
import { findServicesOffering } from "@jendal-workspace/db/repositories/services-catalog";
import { getServicesTeamSettings, servicesTeamRoleFor } from "@jendal-workspace/db/repositories/services-teams";
import {
  ProjectConflictError,
  runInTransaction,
  type OutboxEventInput,
  type UnitOfWork,
} from "@jendal-workspace/db/repositories/unit-of-work";
import { fileUpload } from "@jendal-workspace/db/schema/files";
import { rulebook } from "@jendal-workspace/db/schema/operating-model";
import { amendment, delivery, payment, project, quote, quoteItem } from "@jendal-workspace/db/schema/projects";
import { checkQualityRefundCap, computeLateDeliveryRefundProposal, computeUpfrontBps, type RulebookRules } from "@opmodel/engine-rules";
import { planProjectSchedule } from "@opmodel/engine-scheduler";
import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export type ProjectActor = { teamId: string; role: ServicesTeamRole; actorId: string };

// Exported for the sibling use-case modules (requests.ts) so every procedure fails the same way.
export function fail(code: "NOT_FOUND" | "FORBIDDEN" | "BAD_REQUEST" | "TOO_MANY_REQUESTS", message: string): never {
  throw new TRPCError({ code, message });
}

// A lost compare-and-set race is a client-visible conflict, not a server error.
export async function runProjectTransaction<T>(
  db: DbExecutor,
  run: (tx: Transaction, uow: UnitOfWork) => Promise<T>,
): Promise<T> {
  try {
    return await runInTransaction(db, run);
  } catch (error) {
    if (error instanceof ProjectConflictError) {
      throw new TRPCError({ code: "CONFLICT", message: "The project changed while you worked. Reload and try again." });
    }
    throw error;
  }
}

// The scheduler fires transitions with the same guard people's actions go through.
export function checkTransition(status: ProjectStatus, event: ProjectEvent, facts?: Partial<ProjectFacts>): ProjectStatus {
  const result = transitionProject(status, event, facts);
  if (!result.ok) fail("BAD_REQUEST", transitionRefusalMessage(result.reason));
  return result.to;
}

async function requireProject(tx: DbExecutor, projectId: string): Promise<ProjectRow> {
  const row = await findProjectById(tx, projectId);
  if (!row) fail("NOT_FOUND", "Project not found.");
  return row;
}

async function requireTeamProject(tx: DbExecutor, actor: ProjectActor, projectId: string): Promise<ProjectRow> {
  const row = await requireProject(tx, projectId);
  // An id from another team is reported exactly like a missing one.
  if (row.teamId !== actor.teamId) fail("NOT_FOUND", "Project not found.");
  return row;
}

// Workspace owners and admins are team admins without a services_team_member row (S1).
async function requireTeamMember(tx: Transaction, teamId: string, userId: string): Promise<void> {
  if (!(await servicesTeamRoleFor(tx, teamId, userId))) fail("BAD_REQUEST", "That person is not a member of this team.");
}

// The name given, else the email's local part, else "Client" (design §5.6).
export function contactName(name: string | undefined, email: string | null): string {
  return name?.trim() || email?.split("@")[0] || "Client";
}

export const MIN_TITLE = 3;
export const MAX_TITLE = 120;
const MAX_DELIVERY_DAYS = 365;

// Services spec §5.2 step 1: a manager starts a project with the client's email and/or Discord user.
export async function startProject(
  db: Database,
  actor: ProjectActor,
  input: {
    title: string;
    brief?: string;
    clientEmail?: string;
    clientDiscordId?: string;
    clientName?: string;
    channelId?: string;
    offeringId?: string | null;
  },
): Promise<{ projectId: string }> {
  if (!canStartProject(actor.role)) fail("FORBIDDEN", "Only admins and managers start projects.");
  const title = input.title.trim();
  if (title.length < MIN_TITLE || title.length > MAX_TITLE) {
    fail("BAD_REQUEST", `Give the project a title of ${MIN_TITLE} to ${MAX_TITLE} characters.`);
  }
  const clientEmail = input.clientEmail?.trim().toLowerCase() || null;
  if (clientEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clientEmail)) {
    fail("BAD_REQUEST", "That email address does not look right.");
  }
  const clientDiscordId = input.clientDiscordId?.trim() || null;
  if (!clientEmail && !clientDiscordId) fail("BAD_REQUEST", "Add the client's email or Discord user.");
  const settings = await getServicesTeamSettings(db, actor.teamId);
  if (!settings) fail("NOT_FOUND", "Services team settings not found.");
  const offeringId = input.offeringId?.trim() || null;
  if (offeringId) {
    const offering = await findServicesOffering(db, { id: offeringId, teamId: actor.teamId });
    if (!offering?.active) fail("BAD_REQUEST", "That service is not on your team's list.");
  }

  return runProjectTransaction(db, async (tx, uow) => {
    const published = await ensurePublishedRulebook(tx, actor.teamId);
    const [row] = await tx
      .insert(project)
      .values({
        teamId: actor.teamId,
        title,
        brief: input.brief?.trim() ?? "",
        channelId: input.channelId?.trim() || null,
        offeringId,
        source: "admin",
        currency: settings.currency,
        managementFeeBps: settings.managementFeeBps,
        rulebookId: published.id,
        revisions: published.spec.revisions.freeCount,
        upfrontBps: published.spec.upfront.defaultBps,
        teamCutBps: published.spec.split.teamCutBps,
        managerCutBps: published.spec.split.managerCutBps,
        createdById: actor.actorId,
      })
      .returning();
    if (!row) throw new Error("Insert into project returned no row");
    const clientName = contactName(input.clientName, clientEmail);
    const contactId = await matchOrCreateContact(tx, {
      teamId: actor.teamId,
      email: clientEmail,
      discordId: clientDiscordId,
      name: clientName,
      source: "typed",
    });
    await attachContact(tx, { projectId: row.id, contactId, isPrimary: true, addedById: actor.actorId });
    await uow.apply({
      project: row,
      set: {},
      events: [
        {
          type: "project.created",
          data: { projectId: row.id, title, contactIds: [contactId], clientName, channelId: row.channelId },
        },
      ],
    });
    await armProjectSchedule(tx, row, new Date());
    return { projectId: row.id };
  });
}

async function requireMemberAvailableForNewWork(db: DbExecutor, row: ProjectRow, memberUserId: string): Promise<void> {
  const teamId = row.teamId;
  const member = { teamId, memberUserId };
  await lockMemberWork(db, member);
  if (await memberHasLeavingNotice(db, member)) fail("FORBIDDEN", "This member has given leaving notice and cannot take new requests.");
  const published = await ensurePublishedRulebook(db, teamId);
  const { threshold, windowDays } = published.spec.strikes;
  if (threshold > 0 && await countMemberMarks(db, { ...member, windowDays, now: new Date() }) >= threshold) {
    fail("FORBIDDEN", "This member is suspended from new requests under the team's strike rules.");
  }
  if (row.rulebookId && !(await memberAcceptedRulebook(db, { teamId, userId: memberUserId, rulebookId: published.id }))) {
    fail("FORBIDDEN", "This member must accept the current member agreement on the team's Rules page before taking new work.");
  }
}

// Managers assign the freelancer before quoting in `assigned` mode (services spec §4.3).
export async function assignFreelancer(
  db: Database,
  actor: ProjectActor,
  input: { projectId: string; freelancerId: string },
): Promise<void> {
  if (!canAssignFreelancer(actor.role)) fail("FORBIDDEN", "Only admins and managers assign freelancers.");
  const settings = await getServicesTeamSettings(db, actor.teamId);
  if (!settings) fail("NOT_FOUND", "Services team settings not found.");
  if (settings.solo) fail("BAD_REQUEST", "A solo seller does the work; there is no one to assign.");
  await runProjectTransaction(db, async (tx, uow) => {
    const row = await requireTeamProject(tx, actor, input.projectId);
    checkTransition(row.status, "assign_freelancer");
    await requireTeamMember(tx, actor.teamId, input.freelancerId);
    await requireMemberAvailableForNewWork(tx, row, input.freelancerId);
    await uow.apply({
      project: row,
      set: { assignedFreelancerId: input.freelancerId },
      events: [{ type: "project.assigned", data: { projectId: row.id, freelancerId: input.freelancerId } }],
    });
  });
}

// Services spec §5.2 step 2 and §4.3: a quote is line items and a delivery time, made by whoever the
// team's quoting mode allows.
export async function addQuote(
  db: Database,
  actor: ProjectActor,
  input: { projectId: string; items: QuoteItemDraft[]; deliveryDays: number; freelancerId?: string },
): Promise<{ quoteId: string }> {
  const settings = await getServicesTeamSettings(db, actor.teamId);
  if (!settings) fail("NOT_FOUND", "Services team settings not found.");
  const items = input.items.map((item) => ({ ...item, description: item.description.trim() }));
  const problem = quoteItemsProblem(items);
  if (problem) fail("BAD_REQUEST", quoteItemsProblemMessage(problem));
  if (!Number.isSafeInteger(input.deliveryDays) || input.deliveryDays < 1 || input.deliveryDays > MAX_DELIVERY_DAYS) {
    fail("BAD_REQUEST", `Delivery time must be a whole number of days from 1 to ${MAX_DELIVERY_DAYS}.`);
  }

  return runProjectTransaction(db, async (tx, uow) => {
    const row = await requireTeamProject(tx, actor, input.projectId);
    checkTransition(row.status, "add_quote");
    const author = quoteAuthor({
      role: actor.role,
      actorId: actor.actorId,
      quotingMode: settings.quotingMode,
      assignedFreelancerId: row.assignedFreelancerId,
      freelancerId: input.freelancerId ?? null,
      solo: settings.solo,
    });
    if (!author.ok) {
      fail(author.reason === "not_allowed" ? "FORBIDDEN" : "BAD_REQUEST", quoteAuthorRefusalMessage(author.reason));
    }
    if (author.freelancerId !== actor.actorId) await requireTeamMember(tx, actor.teamId, author.freelancerId);
    await requireMemberAvailableForNewWork(tx, row, author.freelancerId);
    const quoteId = crypto.randomUUID();
    const amountMinor = quoteTotalMinor(items);
    await uow.apply({
      project: row,
      set: {},
      events: [
        {
          type: "quote.created",
          data: { quoteId, projectId: row.id, amountMinor, deliveryDays: input.deliveryDays, freelancerId: author.freelancerId },
        },
      ],
    });
    await tx.insert(quote).values({
      id: quoteId,
      projectId: row.id,
      teamId: actor.teamId,
      freelancerId: author.freelancerId,
      authorId: actor.actorId,
      amountMinor,
      deliveryDays: input.deliveryDays,
    });
    await tx.insert(quoteItem).values(items.map((item, position) => ({ quoteId, position, ...item })));
    // In the request space, so the freelancers looking at the request see the competing quotes (design §4).
    await insertEventMessage(tx, {
      projectId: row.id,
      space: "request",
      body: `${await userDisplayName(tx, author.freelancerId)} sent a quote: ${formatMoney(money(row.currency, amountMinor))}, delivered in ${input.deliveryDays} days.`,
      refType: "quote",
      refId: quoteId,
    });
    await armProjectSchedule(tx, row, new Date(), { memberActivityAt: new Date() });
    return { quoteId };
  });
}

// Services spec §5.2 step 3: only the project's client accepts a quote (the router checks the client
// token). Accepting moves the project to awaiting_deposit and creates the deposit payment.
export async function acceptQuote(
  db: Database,
  input: { projectId: string; quoteId: string },
): Promise<{ paymentId: string; amountMinor: number }> {
  return runProjectTransaction(db, async (tx, uow) => {
    const row = await requireProject(tx, input.projectId);
    const status = checkTransition(row.status, "accept_quote");
    const [found] = await tx
      .select()
      .from(quote)
      .where(and(eq(quote.id, input.quoteId), eq(quote.projectId, row.id)))
      .limit(1);
    if (!found || found.status !== "proposed") fail("BAD_REQUEST", "This quote is not waiting for an answer.");
    await requireMemberAvailableForNewWork(tx, row, found.freelancerId);
    // The pinned rulebook's upfront rule (flat or tiered) fixes the deposit here (AGT-48).
    const rules = await pinnedRulebookRules(tx, row.rulebookId);
    const upfrontBps = rules ? computeUpfrontBps(rules, found.amountMinor) : row.upfrontBps;
    const deposit = depositDue(found.amountMinor, row.managementFeeBps, upfrontBps);
    const paymentId = crypto.randomUUID();
    await uow.apply({
      project: row,
      // The quote names the freelancer who does the work; accepting it assigns them (§5.2 step 3).
      set: { status, assignedFreelancerId: found.freelancerId, upfrontBps },
      events: [
        { type: "quote.accepted", data: { quoteId: found.id, version: found.version, amountMinor: found.amountMinor } },
        { type: "payment.created", data: { paymentId, kind: "deposit", amountMinor: deposit.totalMinor } },
      ],
    });
    await tx.update(quote).set({ status: "accepted", acceptedAt: new Date() }).where(eq(quote.id, found.id));
    await tx
      .update(quote)
      .set({ status: "superseded" })
      .where(and(eq(quote.projectId, row.id), eq(quote.status, "proposed")));
    await tx.insert(payment).values({
      id: paymentId,
      projectId: row.id,
      teamId: row.teamId,
      kind: "deposit",
      currency: row.currency,
      quotePartMinor: deposit.quotePartMinor,
      managementFeeMinor: deposit.managementFeeMinor,
      amountMinor: deposit.totalMinor,
      lines: paymentLines("deposit", deposit, row.managementFeeBps),
    });
    await insertEventMessage(tx, {
      projectId: row.id,
      space: "project",
      body: `The client accepted ${await userDisplayName(tx, found.freelancerId)}'s quote of ${formatMoney(money(row.currency, found.amountMinor))}.`,
      refType: "quote",
      refId: found.id,
    });
    await armProjectSchedule(tx, { ...row, status }, new Date());
    return { paymentId, amountMinor: deposit.totalMinor };
  });
}

async function requireCurrentQuote(tx: Transaction, row: ProjectRow): Promise<QuoteWithItems> {
  const current = await getCurrentQuote(tx, row.id);
  // The status guard already proved the project is past acceptance, so this cannot be missing.
  if (!current) throw new Error(`Project ${row.id} is ${row.status} without an accepted quote`);
  return current;
}

// The rules a project runs under: its pinned rulebook's spec, or null for projects that predate
// rulebooks (the platform defaults then apply).
async function pinnedRulebookRules(db: DbExecutor, rulebookId: string | null): Promise<RulebookRules | null> {
  if (!rulebookId) return null;
  const [row] = await db.select({ spec: rulebook.spec }).from(rulebook).where(eq(rulebook.id, rulebookId)).limit(1);
  return row?.spec ?? null;
}

// Arms, moves or cancels the project's timed rules for its current status (AGT-37, AGT-51, AGT-52).
// Activity anchors belong only to the action being committed; rereading a phase must not restart
// a completed window or recreate a review ladder after the client has replied.
export async function armProjectSchedule(
  db: DbExecutor,
  row: ProjectRow | null,
  _now: Date,
  anchors: { memberActivityAt?: Date; deliveredAt?: Date; workStartedAt?: Date; clientActivity?: boolean } = {},
): Promise<void> {
  if (!row) return;
  const rules = await pinnedRulebookRules(db, row.rulebookId);
  if (!rules) return;
  const held = await projectHasOpenDispute(db, { teamId: row.teamId, projectId: row.id });
  // Keep the current phase ready for resume, but commit its steps as paused under a persisted hold.
  const plan = planProjectSchedule({
    projectStatus: row.status,
    requestedAt: row.createdAt,
    workStartedAt: anchors.workStartedAt ?? null,
    lastMemberActivityAt: anchors.memberActivityAt ?? null,
    deliveredAt: anchors.deliveredAt ?? null,
    pausedByDispute: false,
    rules,
  });
  const reviewKinds = ["client.reviewRemind1", "client.reviewRemind2", "project.autoComplete", "project.abandon"];
  if (row.status === "quoting" && anchors.memberActivityAt) {
    plan.schedule = [];
    plan.cancel.push("request.remind", "request.expire");
  }
  const cancel = new Set<string>(plan.cancel);
  if (row.status === "in_progress" || anchors.clientActivity) {
    for (const kind of reviewKinds) cancel.add(kind);
  }
  await upsertPendingScheduleItems(db, { teamId: row.teamId, subjectId: row.id, schedule: plan.schedule, cancel: [...cancel] });
  if (held) await pauseProjectSchedule(db, { teamId: row.teamId, projectId: row.id });
}

// Services spec §5.5: the assigned freelancer or a manager proposes an amendment in in_progress or
// delivered; a pending amendment or unpaid top-up blocks a new one.
export async function proposeAmendment(
  db: Database,
  actor: ProjectActor,
  input: { projectId: string; add: QuoteItemDraft[]; removeItemIds: string[]; note?: string },
): Promise<{ amendmentId: string }> {
  return runProjectTransaction(db, async (tx, uow) => {
    const row = await requireTeamProject(tx, actor, input.projectId);
    if (!canProposeAmendment({ role: actor.role, actorId: actor.actorId, assignedFreelancerId: row.assignedFreelancerId })) {
      fail("FORBIDDEN", "Only the assigned freelancer or a manager proposes amendments.");
    }
    const facts = await getProjectFacts(tx, row.id);
    checkTransition(row.status, "propose_amendment", facts);
    const current = await requireCurrentQuote(tx, row);
    const amended = amendQuoteItems(current.items, { add: input.add, removeItemIds: input.removeItemIds });
    if (!amended.ok) fail("BAD_REQUEST", amendmentProblemMessage(amended.problem));
    const amendmentId = crypto.randomUUID();
    const newAmountMinor = quoteTotalMinor(amended.items);
    await uow.apply({
      project: row,
      set: {},
      events: [
        {
          type: "amendment.proposed",
          data: { amendmentId, projectId: row.id, deltaMinor: newAmountMinor - current.amountMinor, newAmountMinor },
        },
      ],
    });
    await tx.insert(amendment).values({
      id: amendmentId,
      projectId: row.id,
      teamId: actor.teamId,
      baseQuoteId: current.id,
      proposedById: actor.actorId,
      note: input.note?.trim() ?? "",
      addItems: input.add,
      removeItemIds: input.removeItemIds,
      deltaMinor: newAmountMinor - current.amountMinor,
      newAmountMinor,
      extraDays: amended.extraDays,
    });
    await insertEventMessage(tx, {
      projectId: row.id,
      space: "project",
      body: `The team proposed a change to the quote: ${formatMoney(money(row.currency, newAmountMinor))} in total.`,
      refType: "amendment",
      refId: amendmentId,
    });
    return { amendmentId };
  });
}

// The client accepts an amendment (§5.5): it becomes the current quote version; an increase creates
// the top-up payment, a decrease credits the overpaid management fee to the project.
export async function acceptAmendment(
  db: Database,
  input: { projectId: string; amendmentId: string },
): Promise<{ quoteVersion: number; topUpPaymentId: string | null }> {
  return runProjectTransaction(db, async (tx, uow) => {
    const row = await requireProject(tx, input.projectId);
    const facts = await getProjectFacts(tx, row.id);
    checkTransition(row.status, "accept_amendment", facts);
    const [found] = await tx
      .select()
      .from(amendment)
      .where(and(eq(amendment.id, input.amendmentId), eq(amendment.projectId, row.id)))
      .limit(1);
    if (!found || found.status !== "pending") fail("BAD_REQUEST", "This amendment is not waiting for an answer.");
    const current = await requireCurrentQuote(tx, row);
    if (found.baseQuoteId !== current.id) {
      throw new Error(`Amendment ${found.id} is based on quote ${found.baseQuoteId}, not the current ${current.id}`);
    }
    const effect = amendmentEffect({
      previousQuoteMinor: current.amountMinor,
      newQuoteMinor: found.newAmountMinor,
      managementFeeBps: row.managementFeeBps,
    });
    const amended = amendQuoteItems(current.items, { add: found.addItems, removeItemIds: found.removeItemIds });
    if (!amended.ok) throw new Error(`Amendment ${found.id} no longer applies: ${amended.problem}`);

    const events: OutboxEventInput[] = [
      {
        type: "amendment.accepted",
        data: { amendmentId: found.id, projectId: row.id, quoteVersion: current.version + 1, newAmountMinor: found.newAmountMinor },
      },
    ];
    let topUpPaymentId: string | null = null;
    if (effect.kind === "increase") {
      topUpPaymentId = crypto.randomUUID();
      events.push({
        type: "payment.created",
        data: { paymentId: topUpPaymentId, kind: "top_up", amountMinor: effect.topUp.totalMinor },
      });
    }
    await uow.apply({
      project: row,
      set: {},
      transfers:
        effect.kind === "decrease" && effect.managementFeeCreditMinor > 0
          ? [
              managementFeeCreditTransfer({
                currency: row.currency,
                projectId: row.id,
                amendmentId: found.id,
                creditMinor: effect.managementFeeCreditMinor,
              }),
            ]
          : [],
      events,
    });
    await tx.update(quote).set({ status: "superseded" }).where(eq(quote.id, current.id));
    const [newQuote] = await tx
      .insert(quote)
      .values({
        projectId: row.id,
        teamId: row.teamId,
        version: current.version + 1,
        status: "accepted",
        freelancerId: current.freelancerId,
        authorId: found.proposedById,
        amountMinor: found.newAmountMinor,
        deliveryDays: current.deliveryDays,
        previousQuoteId: current.id,
        amendmentId: found.id,
        acceptedAt: new Date(),
      })
      .returning({ id: quote.id });
    if (!newQuote) throw new Error("Insert into quote returned no row");
    await tx.insert(quoteItem).values(amended.items.map((item, position) => ({ quoteId: newQuote.id, position, ...item })));
    await tx
      .update(amendment)
      .set({
        status: "accepted",
        decidedAt: new Date(),
        resultingQuoteId: newQuote.id,
        managementFeeCreditMinor: effect.kind === "decrease" ? effect.managementFeeCreditMinor : 0,
      })
      .where(eq(amendment.id, found.id));
    if (effect.kind === "increase" && topUpPaymentId) {
      await tx.insert(payment).values({
        id: topUpPaymentId,
        projectId: row.id,
        teamId: row.teamId,
        kind: "top_up",
        currency: row.currency,
        amendmentId: found.id,
        quotePartMinor: effect.topUp.quotePartMinor,
        managementFeeMinor: effect.topUp.managementFeeMinor,
        amountMinor: effect.topUp.totalMinor,
        lines: paymentLines("top_up", effect.topUp, row.managementFeeBps),
      });
    }
    await insertEventMessage(tx, {
      projectId: row.id,
      space: "project",
      body: "The client accepted the change to the quote.",
      refType: "amendment",
      refId: found.id,
    });
    return { quoteVersion: current.version + 1, topUpPaymentId };
  });
}

export async function declineAmendment(db: Database, input: { projectId: string; amendmentId: string }): Promise<void> {
  await runProjectTransaction(db, async (tx, uow) => {
    const row = await requireProject(tx, input.projectId);
    const facts = await getProjectFacts(tx, row.id);
    checkTransition(row.status, "decline_amendment", facts);
    const [found] = await tx
      .select()
      .from(amendment)
      .where(and(eq(amendment.id, input.amendmentId), eq(amendment.projectId, row.id)))
      .limit(1);
    if (!found || found.status !== "pending") fail("BAD_REQUEST", "This amendment is not waiting for an answer.");
    await uow.apply({
      project: row,
      set: {},
      events: [{ type: "amendment.declined", data: { amendmentId: found.id, projectId: row.id } }],
    });
    await tx.update(amendment).set({ status: "declined", decidedAt: new Date() }).where(eq(amendment.id, found.id));
    await insertEventMessage(tx, {
      projectId: row.id,
      space: "project",
      body: "The client declined the change to the quote.",
      refType: "amendment",
      refId: found.id,
    });
  });
}

export const MAX_DELIVERY_NOTE = 5_000;
export const MAX_DELIVERY_LINK = 2_000;

function deliveryInput(input: { note: string; link: string; fileUploadId?: string }) {
  const note = input.note.trim();
  const link = input.link.trim();
  if (!note && !link && !input.fileUploadId) fail("BAD_REQUEST", "Add a note, a link or a file.");
  if (note.length > MAX_DELIVERY_NOTE) fail("BAD_REQUEST", "The note is too long.");
  if (link) {
    // The client opens the link from the client page, so only web links are accepted.
    let protocol: string | null = null;
    try {
      protocol = new URL(link).protocol;
    } catch {
      protocol = null;
    }
    if (protocol !== "https:" || link.length > MAX_DELIVERY_LINK) fail("BAD_REQUEST", "Use an https link.");
  }
  return { note, link: link || null };
}

const SUBMIT_DELIVERY_REFUSAL = "Only the assigned freelancer or a manager can deliver.";
const FILE_UNUSABLE = "This file cannot be used for this delivery.";
export const UPLOAD_URL_SECONDS = 900;
export const DOWNLOAD_URL_SECONDS = 300;
export const UPLOAD_LIMIT = { max: 20, windowMs: 600_000 };

// Sellers design §5.1: the browser uploads the delivery file straight to the bucket with a presigned PUT;
// the row records what was announced so the delivery can check the object against it.
export async function startDeliveryUpload(
  db: Database,
  files: FileStore,
  actor: ProjectActor,
  input: { projectId: string; fileName: string; sizeBytes: number },
): Promise<{ uploadId: string; url: string; headers: Record<string, string> }> {
  const checked = checkUploadFile({ name: input.fileName, sizeBytes: input.sizeBytes });
  if (!checked.ok) fail("BAD_REQUEST", checked.problem);
  const allowed = await hitRequestLimit(db, { key: `delivery-upload:${actor.actorId}`, ...UPLOAD_LIMIT });
  if (!allowed) fail("TOO_MANY_REQUESTS", "Too many uploads. Wait a few minutes and try again.");
  const row = await requireTeamProject(db, actor, input.projectId);
  if (!canSubmitDelivery({ role: actor.role, actorId: actor.actorId, assignedFreelancerId: row.assignedFreelancerId })) {
    fail("FORBIDDEN", SUBMIT_DELIVERY_REFUSAL);
  }
  if (row.status !== "in_progress") fail("BAD_REQUEST", "Files can be added while the project is in progress.");
  const uploadId = crypto.randomUUID();
  const key = `deliveries/${row.teamId}/${row.id}/${uploadId}`;
  await insertFileUpload(db, {
    id: uploadId,
    teamId: row.teamId,
    projectId: row.id,
    purpose: "delivery",
    r2Key: key,
    fileName: checked.fileName,
    contentType: checked.contentType,
    sizeBytes: input.sizeBytes,
    createdById: actor.actorId,
  });
  const { url, headers } = await files.presignPut({
    key,
    contentType: checked.contentType,
    sizeBytes: input.sizeBytes,
    expiresInSeconds: UPLOAD_URL_SECONDS,
  });
  return { uploadId, url, headers };
}

// The bucket is asked before the transaction so no row lock waits on the network. Only an upload of this
// team and project is looked up there; any other id gets the same answer as an unknown one.
async function requireUploadedFile(
  db: Database,
  files: FileStore,
  actor: ProjectActor,
  input: { projectId: string; fileUploadId: string },
): Promise<void> {
  const upload = await findFileUpload(db, input.fileUploadId);
  if (!upload || upload.teamId !== actor.teamId || upload.projectId !== input.projectId) {
    fail("BAD_REQUEST", FILE_UNUSABLE);
  }
  const stored = await files.head(upload.r2Key);
  if (!stored || stored.sizeBytes !== upload.sizeBytes) fail("BAD_REQUEST", "The file did not finish uploading.");
}

// Services spec §5.2 step 5: the assigned freelancer or a manager submits the work for the client's answer.
export async function submitDelivery(
  db: Database,
  files: FileStore,
  actor: ProjectActor,
  input: { projectId: string; note: string; link: string; fileUploadId?: string },
): Promise<{ deliveryId: string }> {
  const { note, link } = deliveryInput(input);
  const { fileUploadId } = input;
  if (fileUploadId) await requireUploadedFile(db, files, actor, { projectId: input.projectId, fileUploadId });
  return runProjectTransaction(db, async (tx, uow) => {
    const row = await requireTeamProject(tx, actor, input.projectId);
    if (!canSubmitDelivery({ role: actor.role, actorId: actor.actorId, assignedFreelancerId: row.assignedFreelancerId })) {
      fail("FORBIDDEN", SUBMIT_DELIVERY_REFUSAL);
    }
    const status = checkTransition(row.status, "submit_delivery");
    if (
      fileUploadId &&
      !(await lockFileUploadForAttach(tx, { id: fileUploadId, teamId: row.teamId, projectId: row.id, purpose: "delivery" }))
    ) {
      fail("BAD_REQUEST", FILE_UNUSABLE);
    }
    const deliveredAt = new Date();
    const deliveryId = crypto.randomUUID();
    const late = await lateRefundProposal(tx, row, deliveredAt);
    const events: OutboxEventInput[] = [{ type: "delivery.submitted", data: { deliveryId } }];
    if (late) events.push({ type: "project.late_refund_proposed", data: { amountMinor: late.proposedRefundMinor, daysLate: late.daysLate } });
    await uow.apply({
      project: row,
      set: late
        ? { status, lateRefundStatus: "pending", lateRefundProposedMinor: late.proposedRefundMinor, lateRefundDaysLate: late.daysLate }
        : { status },
      events,
    });
    // A redelivery updates a waiting proposal; the mark is recorded once.
    if (late && row.lateRefundStatus === null && row.assignedFreelancerId) {
      await recordMemberMark(tx, { teamId: row.teamId, memberUserId: row.assignedFreelancerId, projectId: row.id, kind: "late_delivery" });
    }
    await tx.insert(delivery).values({
      id: deliveryId,
      projectId: row.id,
      teamId: row.teamId,
      submittedById: actor.actorId,
      note,
      link,
      fileUploadId: fileUploadId ?? null,
      createdAt: deliveredAt,
    });
    if (fileUploadId) await markFileUploadAttached(tx, fileUploadId);
    await insertEventMessage(tx, {
      projectId: row.id,
      space: "project",
      body: `${await userDisplayName(tx, actor.actorId)} delivered the work.`,
      refType: "delivery",
      refId: deliveryId,
    });
    await armProjectSchedule(tx, { ...row, status }, deliveredAt, { deliveredAt });
    return { deliveryId };
  });
}

// The late-delivery refund a delivery after the deadline proposes under the pinned rules; null when on time, when
// the rules charge nothing, or once an admin decided an earlier proposal.
async function lateRefundProposal(tx: Transaction, row: ProjectRow, deliveredAt: Date) {
  if (!row.deadlineAt || row.lateRefundStatus === "confirmed" || row.lateRefundStatus === "waived") return null;
  const rules = await pinnedRulebookRules(tx, row.rulebookId);
  if (!rules) return null;
  const current = await requireCurrentQuote(tx, row);
  const proposal = computeLateDeliveryRefundProposal(rules, current.amountMinor, row.deadlineAt, deliveredAt);
  return proposal.proposedRefundMinor > 0 ? proposal : null;
}

// Only a confirmed proposal changes the price; the member's share pays it at completion.
export function confirmedLateRefundMinor(row: Pick<ProjectRow, "lateRefundStatus" | "lateRefundProposedMinor">): number {
  return row.lateRefundStatus === "confirmed" ? (row.lateRefundProposedMinor ?? 0) : 0;
}

// Decisions on refunds stay open until the client accepts the delivery, which fixes the final price.
const PRICE_OPEN_STATUSES: readonly ProjectStatus[] = ["in_progress", "delivered"];

// An admin's press confirms or waives a late-delivery refund proposal; nothing moves until the price is fixed.
export async function decideLateDeliveryRefund(
  db: Database,
  actor: ProjectActor,
  input: { projectId: string; decision: "confirm" | "waive" },
): Promise<void> {
  if (!canServicesTeam(actor.role, "resolve_cases")) fail("FORBIDDEN", "Only an admin can decide a late-delivery refund.");
  await runProjectTransaction(db, async (tx, uow) => {
    const row = await requireTeamProject(tx, actor, input.projectId);
    if (row.lateRefundStatus !== "pending") fail("BAD_REQUEST", "There is no late-delivery refund waiting for a decision.");
    if (!PRICE_OPEN_STATUSES.includes(row.status)) fail("BAD_REQUEST", "The client already accepted the delivery, so the price is fixed.");
    const confirmed = input.decision === "confirm";
    const amountMinor = row.lateRefundProposedMinor ?? 0;
    await uow.apply({
      project: row,
      set: { lateRefundStatus: confirmed ? "confirmed" : "waived", lateRefundDecidedBy: actor.actorId, lateRefundDecidedAt: new Date() },
      events: [{ type: "project.late_refund_decided", data: { decision: input.decision, amountMinor } }],
    });
    if (confirmed) {
      await insertEventMessage(tx, {
        projectId: row.id,
        space: "project",
        body: `The team confirmed a late-delivery refund of ${formatMoney(money(row.currency, amountMinor))}. It comes off the final price.`,
        refType: "late_refund",
        refId: row.id,
      });
    }
  });
}

// A quality refund lowers the price within the pinned rulebook's cap for the project's phase; 0 clears it.
export async function setQualityRefund(
  db: Database,
  actor: ProjectActor,
  input: { projectId: string; amountMinor: number },
): Promise<void> {
  if (!canServicesTeam(actor.role, "resolve_cases")) fail("FORBIDDEN", "Only an admin can set a quality refund.");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0) fail("BAD_REQUEST", "Enter a refund of zero or more.");
  await runProjectTransaction(db, async (tx, uow) => {
    const row = await requireTeamProject(tx, actor, input.projectId);
    if (!PRICE_OPEN_STATUSES.includes(row.status)) fail("BAD_REQUEST", "A quality refund can be set while the work is in progress or delivered.");
    const rules = await pinnedRulebookRules(tx, row.rulebookId);
    if (!rules) fail("BAD_REQUEST", "This project started before team rules, so it has no refund caps.");
    const current = await requireCurrentQuote(tx, row);
    const phase = row.status === "in_progress" ? "in_progress" : "after_delivery";
    const { allowed, capMinor } = checkQualityRefundCap(rules, phase, input.amountMinor, current.amountMinor);
    if (!allowed) {
      fail("BAD_REQUEST", `REFUND_EXCEEDS_RULEBOOK_CAP: the team rules allow up to ${formatMoney(money(row.currency, capMinor))} at this stage.`);
    }
    const amountMinor = input.amountMinor === 0 ? null : input.amountMinor;
    await uow.apply({
      project: row,
      set: { qualityRefundMinor: amountMinor, qualityRefundSetBy: actor.actorId, qualityRefundSetAt: new Date() },
      events: [{ type: "project.quality_refund_set", data: { amountMinor: input.amountMinor } }],
    });
    await insertEventMessage(tx, {
      projectId: row.id,
      space: "project",
      body: amountMinor
        ? `The team set a quality refund of ${formatMoney(money(row.currency, amountMinor))}. It comes off the final price.`
        : "The team removed the quality refund.",
      refType: "quality_refund",
      refId: row.id,
    });
  });
}

// Callers check access to the project first; the link names the file so the browser saves it under that name.
export async function deliveryFileUrl(
  db: Database,
  files: FileStore,
  input: { projectId: string; deliveryId: string },
): Promise<{ url: string }> {
  const [found] = await db
    .select({ r2Key: fileUpload.r2Key, fileName: fileUpload.fileName })
    .from(delivery)
    .innerJoin(fileUpload, eq(delivery.fileUploadId, fileUpload.id))
    .where(and(eq(delivery.id, input.deliveryId), eq(delivery.projectId, input.projectId)))
    .limit(1);
  if (!found) fail("BAD_REQUEST", "This delivery has no file.");
  const url = await files.presignGet({ key: found.r2Key, fileName: found.fileName, expiresInSeconds: DOWNLOAD_URL_SECONDS });
  return { url };
}

async function requireOpenDelivery(tx: Transaction, projectId: string, deliveryId: string): Promise<DeliveryRow> {
  const [found] = await tx
    .select()
    .from(delivery)
    .where(and(eq(delivery.id, deliveryId), eq(delivery.projectId, projectId)))
    .limit(1);
  if (!found || found.status !== "submitted") fail("BAD_REQUEST", "This delivery is not waiting for an answer.");
  return found;
}

// Services spec §5.2 step 6: the client sends the work back with what should change; it counts a revision.
export async function requestChanges(
  db: Database,
  input: { projectId: string; deliveryId: string; note: string },
): Promise<void> {
  const note = input.note.trim();
  if (!note) fail("BAD_REQUEST", "Say what should change.");
  if (note.length > MAX_DELIVERY_NOTE) fail("BAD_REQUEST", "The note is too long.");
  await runProjectTransaction(db, async (tx, uow) => {
    const row = await requireProject(tx, input.projectId);
    const found = await requireOpenDelivery(tx, row.id, input.deliveryId);
    const status = checkTransition(row.status, "request_changes");
    // The free rounds the pinned rulebook allows; past them the client is pointed at a paid
    // revision amendment (AGT-49). Projects that predate rulebooks keep the old behavior.
    if (row.rulebookId) {
      const used = await tx
        .select({ count: sql<number>`count(*)::int`.mapWith(Number) })
        .from(delivery)
        .where(and(eq(delivery.projectId, row.id), eq(delivery.status, "changes_requested")));
      if ((used[0]?.count ?? 0) >= row.revisions) {
        const rules = await pinnedRulebookRules(tx, row.rulebookId);
        const priceMinor = rules?.revisions.paidRevisionPriceMinor ?? 0;
        fail(
          "BAD_REQUEST",
          priceMinor > 0
            ? `REVISION_LIMIT_REACHED: the free rounds are used; a paid revision costs ${formatMoney(money(row.currency, priceMinor))}.`
            : "REVISION_LIMIT_REACHED: the free rounds are used.",
        );
      }
    }
    await uow.apply({
      project: row,
      set: { status, revisions: row.rulebookId ? row.revisions : row.revisions + 1 },
      events: [{ type: "delivery.changes_requested", data: { deliveryId: found.id } }],
    });
    await tx
      .update(delivery)
      .set({ status: "changes_requested", clientNote: note, decidedAt: new Date() })
      .where(eq(delivery.id, found.id));
    await insertEventMessage(tx, {
      projectId: row.id,
      space: "project",
      body: "The client asked for changes to the delivery.",
      refType: "delivery",
      refId: found.id,
    });
    const workStartedAt = new Date();
    await armProjectSchedule(tx, { ...row, status }, workStartedAt, { clientActivity: true, workStartedAt });
  });
}

// Services spec §5.2 step 6 and §5.3: accepting fixes the final price and opens the balance payment, or
// completes the project at once when nothing is left to pay.
export async function acceptDelivery(
  db: Database,
  input: { projectId: string; deliveryId: string },
): Promise<{ status: "awaiting_balance" | "completed"; balancePaymentId: string | null }> {
  return settleDelivery(db, input, "accept_delivery");
}

// Timed system acceptance shares settlement, while client adapters retain their access checks.
export async function autoAcceptDelivery(db: DbExecutor, projectId: string): Promise<void> {
  const row = await findProjectById(db, projectId);
  if (!row || row.status !== "delivered") return;
  try {
    const [found] = await db.select().from(delivery)
      .where(and(eq(delivery.projectId, projectId), eq(delivery.status, "submitted"))).limit(1);
    if (!found) throw new Error(`Project ${projectId} is delivered without an open delivery`);
    await settleDelivery(db, { projectId, deliveryId: found.id }, "auto_complete");
  } catch (error) {
    // A concurrent client decision can retire this timer before its compare-and-set wins.
    const latest = await findProjectById(db, projectId);
    if (latest && latest.status !== "delivered") return;
    throw error;
  }
}

async function settleDelivery(
  db: DbExecutor,
  input: { projectId: string; deliveryId: string },
  event: "accept_delivery" | "auto_complete",
): Promise<{ status: "awaiting_balance" | "completed"; balancePaymentId: string | null }> {
  return runProjectTransaction(db, async (tx, uow) => {
    const row = await requireProject(tx, input.projectId);
    const found = await requireOpenDelivery(tx, row.id, input.deliveryId);
    const current = await requireCurrentQuote(tx, row);
    const facts = await getProjectFacts(tx, row.id);
    const priceAfterQuality = finalPriceMinor(current.amountMinor, row.qualityRefundMinor ?? 0);
    const finalPrice = finalPriceMinor(priceAfterQuality, confirmedLateRefundMinor(row));
    const balance = balanceDue({
      quoteMinor: current.amountMinor,
      managementFeeBps: row.managementFeeBps,
      finalPriceMinor: finalPrice,
      paidQuoteMinor: facts.paidQuoteMinor,
      paidManagementFeeMinor: facts.paidManagementFeeMinor,
      managementFeeCreditedMinor: facts.managementFeeCreditedMinor,
    });
    const status = checkTransition(row.status, event, { ...facts, balanceDueMinor: balance.dueMinor });
    const accepted: OutboxEventInput = {
      type: "delivery.accepted",
      data: { deliveryId: found.id, finalPriceMinor: finalPrice },
    };

    const acceptanceEvents: OutboxEventInput[] = [accepted];
    if (event === "auto_complete") {
      acceptanceEvents.push({ type: "project.auto_completed", data: { projectId: row.id, to: status } });
    }
    let balancePaymentId: string | null = null;
    if (status === "awaiting_balance") {
      balancePaymentId = crypto.randomUUID();
      await uow.apply({
        project: row,
        set: { status, finalPriceMinor: finalPrice },
        events: [
          ...acceptanceEvents,
          { type: "payment.created", data: { paymentId: balancePaymentId, kind: "balance", amountMinor: balance.dueMinor } },
        ],
      });
      const split = {
        quotePartMinor: balance.quotePartMinor,
        managementFeeMinor: balance.managementFeePartMinor,
        totalMinor: balance.dueMinor,
      };
      await tx.insert(payment).values({
        id: balancePaymentId,
        projectId: row.id,
        teamId: row.teamId,
        kind: "balance",
        currency: row.currency,
        quotePartMinor: split.quotePartMinor,
        managementFeeMinor: split.managementFeeMinor,
        amountMinor: split.totalMinor,
        lines: paymentLines("balance", split, row.managementFeeBps),
      });
    } else if (status === "completed") {
      // Quoting assigns the freelancer, so an accepted quote without one is a broken invariant.
      if (!row.assignedFreelancerId) throw new Error(`Project ${row.id} is ${row.status} without an assigned freelancer`);
      const completion = completionPostings({
        currency: row.currency,
        projectId: row.id,
        freelancerId: row.assignedFreelancerId,
        finalPriceMinor: finalPrice,
        teamCutBps: row.teamCutBps,
        managerId: row.managerId,
        managerCutBps: row.managerCutBps,
        memberBearsMinor: priceAfterQuality - finalPrice,
        balance,
      });
      const events: OutboxEventInput[] = [...acceptanceEvents, { type: "project.completed", data: { finalPriceMinor: finalPrice } }];
      if (completion.refundMinor > 0) {
        events.push({
          type: "refund.requested",
          data: { amountMinor: completion.refundMinor, refundId: completionRefundId(row.id) },
        });
      }
      await uow.apply({
        project: row,
        set: { status, finalPriceMinor: finalPrice },
        transfers: completion.transfers,
        events,
      });
      if (completion.refundMinor > 0) {
        await createProjectRefund(tx, {
          id: completionRefundId(row.id),
          teamId: row.teamId,
          projectId: row.id,
          currency: row.currency,
          amountMinor: completion.refundMinor,
        });
      }
    } else {
      throw new Error(`accept_delivery moved project ${row.id} to ${status}`);
    }
    await tx.update(delivery).set({ status: "accepted", decidedAt: new Date() }).where(eq(delivery.id, found.id));
    await insertEventMessage(tx, {
      projectId: row.id,
      space: "project",
      body: event === "auto_complete" ? "The review window closed and the delivery was accepted." : "The client accepted the delivery.",
      refType: "delivery",
      refId: found.id,
    });
    if (event === "accept_delivery") await armProjectSchedule(tx, { ...row, status }, new Date());
    return { status, balancePaymentId };
  });
}
