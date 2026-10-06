import {
  canAssignFreelancer,
  canStartProject,
  depositDue,
  quoteAuthor,
  quoteAuthorRefusalMessage,
  quoteItemsProblem,
  quoteItemsProblemMessage,
  quoteTotalMinor,
  transitionProject,
  paymentLines,
  transitionRefusalMessage,
  type ProjectEvent,
  type ProjectFacts,
  type ProjectStatus,
  type QuoteItemDraft,
  type ServicesTeamRole,
} from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import type { Transaction } from "@jendal-workspace/db/executor";
import { findProjectById, type ProjectRow } from "@jendal-workspace/db/repositories/projects";
import { getServicesTeamSettings } from "@jendal-workspace/db/repositories/services-teams";
import {
  ProjectConflictError,
  runInTransaction,
  type UnitOfWork,
} from "@jendal-workspace/db/repositories/unit-of-work";
import { payment, project, quote, quoteItem } from "@jendal-workspace/db/schema/projects";
import { servicesTeamMember } from "@jendal-workspace/db/schema/services-teams";
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

async function requireTeamMember(tx: Transaction, teamId: string, userId: string): Promise<void> {
  const [membership] = await tx
    .select({ id: servicesTeamMember.id })
    .from(servicesTeamMember)
    .where(and(eq(servicesTeamMember.teamId, teamId), eq(servicesTeamMember.userId, userId)))
    .limit(1);
  if (!membership) fail("BAD_REQUEST", "That person is not a member of this team.");
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
