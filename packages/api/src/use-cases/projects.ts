import {
  amendmentEffect,
  amendmentProblemMessage,
  amendQuoteItems,
  canAssignFreelancer,
  canProposeAmendment,
  canStartProject,
  depositDue,
  managementFeeCreditTransfer,
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
  type ServicesTeamRole,
} from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { Transaction } from "@jendal-workspace/db/executor";
import {
  findProjectById,
  getCurrentQuote,
  getProjectFacts,
  type ProjectRow,
  type QuoteWithItems,
} from "@jendal-workspace/db/repositories/projects";
import { getServicesTeamSettings, servicesTeamRoleFor } from "@jendal-workspace/db/repositories/services-teams";
import {
  ProjectConflictError,
  runInTransaction,
  type OutboxEventInput,
  type UnitOfWork,
} from "@jendal-workspace/db/repositories/unit-of-work";
import { amendment, payment, project, quote, quoteItem } from "@jendal-workspace/db/schema/projects";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export type ProjectActor = { teamId: string; role: ServicesTeamRole; actorId: string };

function fail(code: "NOT_FOUND" | "FORBIDDEN" | "BAD_REQUEST", message: string): never {
  throw new TRPCError({ code, message });
}

// A lost compare-and-set race is a client-visible conflict, not a server error.
async function runProjectTransaction<T>(
  db: Database,
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

function checkTransition(status: ProjectStatus, event: ProjectEvent, facts?: Partial<ProjectFacts>): ProjectStatus {
  const result = transitionProject(status, event, facts);
  if (!result.ok) fail("BAD_REQUEST", transitionRefusalMessage(result.reason));
  return result.to;
}

async function requireProject(tx: Transaction, projectId: string): Promise<ProjectRow> {
  const row = await findProjectById(tx, projectId);
  if (!row) fail("NOT_FOUND", "Project not found.");
  return row;
}

async function requireTeamProject(tx: Transaction, actor: ProjectActor, projectId: string): Promise<ProjectRow> {
  const row = await requireProject(tx, projectId);
  // An id from another team is reported exactly like a missing one.
  if (row.teamId !== actor.teamId) fail("NOT_FOUND", "Project not found.");
  return row;
}

// Workspace owners and admins are team admins without a services_team_member row (S1).
async function requireTeamMember(tx: Transaction, teamId: string, userId: string): Promise<void> {
  if (!(await servicesTeamRoleFor(tx, teamId, userId))) fail("BAD_REQUEST", "That person is not a member of this team.");
}

const MAX_TITLE = 120;
const MAX_DELIVERY_DAYS = 365;

// Services spec §5.2 step 1: a manager starts a project with the client's email and/or Discord user.
export async function startProject(
  db: Database,
  actor: ProjectActor,
  input: { title: string; brief?: string; clientEmail?: string; clientDiscordId?: string; channelId?: string },
): Promise<{ projectId: string }> {
  if (!canStartProject(actor.role)) fail("FORBIDDEN", "Only admins and managers start projects.");
  const title = input.title.trim();
  if (title.length < 3 || title.length > MAX_TITLE) {
    fail("BAD_REQUEST", `Give the project a title of 3 to ${MAX_TITLE} characters.`);
  }
  const clientEmail = input.clientEmail?.trim().toLowerCase() || null;
  if (clientEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clientEmail)) {
    fail("BAD_REQUEST", "That email address does not look right.");
  }
  const clientDiscordId = input.clientDiscordId?.trim() || null;
  if (!clientEmail && !clientDiscordId) fail("BAD_REQUEST", "Add the client's email or Discord user.");
  const settings = await getServicesTeamSettings(db, actor.teamId);
  if (!settings) fail("NOT_FOUND", "Services team settings not found.");

  return runProjectTransaction(db, async (tx, uow) => {
    const [row] = await tx
      .insert(project)
      .values({
        teamId: actor.teamId,
        title,
        brief: input.brief?.trim() ?? "",
        clientEmail,
        clientDiscordId,
        channelId: input.channelId?.trim() || null,
        currency: settings.currency,
        managementFeeBps: settings.managementFeeBps,
        teamCutBps: settings.teamCutBps,
        createdById: actor.actorId,
      })
      .returning();
    if (!row) throw new Error("Insert into project returned no row");
    await uow.apply({
      project: row,
      set: {},
      events: [
        {
          type: "project.created",
          data: { projectId: row.id, title, clientEmail, clientDiscordId, channelId: row.channelId },
        },
      ],
    });
    return { projectId: row.id };
  });
}

// Managers assign the freelancer before quoting in `assigned` mode (services spec §4.3).
export async function assignFreelancer(
  db: Database,
  actor: ProjectActor,
  input: { projectId: string; freelancerId: string },
): Promise<void> {
  if (!canAssignFreelancer(actor.role)) fail("FORBIDDEN", "Only admins and managers assign freelancers.");
  await runProjectTransaction(db, async (tx, uow) => {
    const row = await requireTeamProject(tx, actor, input.projectId);
    checkTransition(row.status, "assign_freelancer");
    await requireTeamMember(tx, actor.teamId, input.freelancerId);
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
    });
    if (!author.ok) {
      fail(author.reason === "not_allowed" ? "FORBIDDEN" : "BAD_REQUEST", quoteAuthorRefusalMessage(author.reason));
    }
    if (author.freelancerId !== actor.actorId) await requireTeamMember(tx, actor.teamId, author.freelancerId);
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
    const deposit = depositDue(found.amountMinor, row.managementFeeBps);
    const paymentId = crypto.randomUUID();
    await uow.apply({
      project: row,
      // The quote names the freelancer who does the work; accepting it assigns them (§5.2 step 3).
      set: { status, assignedFreelancerId: found.freelancerId },
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
    return { paymentId, amountMinor: deposit.totalMinor };
  });
}

async function requireCurrentQuote(tx: Transaction, row: ProjectRow): Promise<QuoteWithItems> {
  const current = await getCurrentQuote(tx, row.id);
  // The status guard already proved the project is past acceptance, so this cannot be missing.
  if (!current) throw new Error(`Project ${row.id} is ${row.status} without an accepted quote`);
  return current;
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
  });
}
