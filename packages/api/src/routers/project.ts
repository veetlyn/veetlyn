import { MAX_QUOTE_ITEMS } from "@jendal-workspace/core";
import {
  findProjectById,
  listProjectAmendments,
  listProjectPayments,
  listProjectQuotes,
  listTeamProjects,
} from "@jendal-workspace/db/repositories/projects";
import { canSeeProject, type QuotingMode } from "@jendal-workspace/core";
import { getServicesTeamSettings, listServicesTeamMembers } from "@jendal-workspace/db/repositories/services-teams";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { linkSecret, signClientLink, signPayLink, verifyClientLink } from "../client-links";
import { publicProcedure, router } from "../index";
import { servicesTeamProcedure } from "../services-team-procedure";
import {
  acceptAmendment,
  acceptQuote,
  addQuote,
  assignFreelancer,
  declineAmendment,
  proposeAmendment,
  startProject,
} from "../use-cases/projects";

const quoteItemInput = z.object({
  description: z.string().trim().min(1).max(200),
  amountMinor: z.number().int().positive(),
  extraDays: z.number().int().min(0).max(365).default(0),
});

const projectIdInput = z.object({ projectId: z.string().uuid() });

async function projectIdFromToken(auth: { options: Record<string, unknown> }, token: string): Promise<string> {
  const projectId = await verifyClientLink(linkSecret(auth), token);
  if (!projectId) throw new TRPCError({ code: "NOT_FOUND", message: "This link is not valid." });
  return projectId;
}

export const projectRouter = router({
  list: servicesTeamProcedure.query(async ({ ctx }) => {
    const settings = await getServicesTeamSettings(ctx.db, ctx.servicesTeam.id);
    const rows = await listTeamProjects(ctx.db, ctx.servicesTeam.id);
    return rows
      .filter((row) =>
        canSeeProject({
          role: ctx.servicesTeamRole,
          actorId: ctx.session.user.id,
          assignedFreelancerId: row.assignedFreelancerId,
          status: row.status,
          quotingMode: (settings?.quotingMode ?? "assigned") as QuotingMode,
        }),
      )
      .map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        currency: row.currency,
        clientEmail: row.clientEmail,
        clientDiscordId: row.clientDiscordId,
        createdAt: row.createdAt,
      }));
  }),

  get: servicesTeamProcedure.input(projectIdInput).query(async ({ ctx, input }) => {
    const [settings, projects] = await Promise.all([
      getServicesTeamSettings(ctx.db, ctx.servicesTeam.id),
      listTeamProjects(ctx.db, ctx.servicesTeam.id),
    ]);
    const row = projects.find((p) => p.id === input.projectId);
    if (
      !row ||
      !canSeeProject({
        role: ctx.servicesTeamRole,
        actorId: ctx.session.user.id,
        assignedFreelancerId: row.assignedFreelancerId,
        status: row.status,
        quotingMode: (settings?.quotingMode ?? "assigned") as QuotingMode,
      })
    ) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
    }
    const [quotes, amendments, payments] = await Promise.all([
      listProjectQuotes(ctx.db, row.id),
      listProjectAmendments(ctx.db, row.id),
      listProjectPayments(ctx.db, row.id),
    ]);
    const clientToken = await signClientLink(linkSecret(ctx.auth), row.id);
    return {
      project: row,
      quotes,
      amendments,
      payments,
      clientPath: `/c/${clientToken}`,
      role: ctx.servicesTeamRole,
      quotingMode: settings?.quotingMode ?? "assigned",
      viewerId: ctx.session.user.id,
    };
  }),

  members: servicesTeamProcedure.query(async ({ ctx }) => {
    const rows = await listServicesTeamMembers(ctx.db, ctx.servicesTeam);
    return rows.map((row) => ({ id: row.userId, name: row.name, email: row.email, role: row.role }));
  }),

  create: servicesTeamProcedure
    .input(
      z.object({
        title: z.string().max(200),
        brief: z.string().max(5000).default(""),
        clientEmail: z.string().max(200).default(""),
        clientDiscordId: z.string().max(64).default(""),
        channelId: z.string().max(64).default(""),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const actor = { teamId: ctx.servicesTeam.id, role: ctx.servicesTeamRole, actorId: ctx.session.user.id };
      const { projectId } = await startProject(ctx.db, actor, input);
      const clientToken = await signClientLink(linkSecret(ctx.auth), projectId);
      return { projectId, clientPath: `/c/${clientToken}` };
    }),

  assign: servicesTeamProcedure
    .input(projectIdInput.extend({ freelancerId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assignFreelancer(ctx.db, { teamId: ctx.servicesTeam.id, role: ctx.servicesTeamRole, actorId: ctx.session.user.id }, input);
    }),

  addQuote: servicesTeamProcedure
    .input(
      projectIdInput.extend({
        items: z.array(quoteItemInput).min(1).max(MAX_QUOTE_ITEMS),
        deliveryDays: z.number().int().min(1).max(365),
        freelancerId: z.string().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return addQuote(ctx.db, { teamId: ctx.servicesTeam.id, role: ctx.servicesTeamRole, actorId: ctx.session.user.id }, input);
    }),

  proposeAmendment: servicesTeamProcedure
    .input(
      projectIdInput.extend({
        add: z.array(quoteItemInput).max(MAX_QUOTE_ITEMS).default([]),
        removeItemIds: z.array(z.string().uuid()).max(MAX_QUOTE_ITEMS).default([]),
        note: z.string().max(2000).default(""),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return proposeAmendment(
        ctx.db,
        { teamId: ctx.servicesTeam.id, role: ctx.servicesTeamRole, actorId: ctx.session.user.id },
        input,
      );
    }),

  // The client project page (services spec §5.2): signed link, no account. Internal user ids
  // (freelancerId, authorId, proposedById) and the PayPal ids stay server-side; the link holder
  // sees only what the page renders.
  clientGet: publicProcedure.input(z.object({ token: z.string().min(1) })).query(async ({ ctx, input }) => {
    const projectId = await projectIdFromToken(ctx.auth, input.token);
    const row = await findProjectById(ctx.db, projectId);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "This link is not valid." });
    const [quotes, amendments, payments] = await Promise.all([
      listProjectQuotes(ctx.db, projectId),
      listProjectAmendments(ctx.db, projectId),
      listProjectPayments(ctx.db, projectId),
    ]);
    const secret = linkSecret(ctx.auth);
    // Pending and failed payments can be paid; the pay link names the payment, never the amount (§5.4).
    const paymentViews = await Promise.all(
      payments.map(async (p) => ({
        id: p.id,
        kind: p.kind,
        status: p.status,
        amountMinor: p.amountMinor,
        lines: p.lines,
        createdAt: p.createdAt,
        payPath: p.status === "pending" || p.status === "failed" ? `/pay/${await signPayLink(secret, p.id)}` : null,
      })),
    );
    return {
      project: {
        id: row.id,
        title: row.title,
        brief: row.brief,
        status: row.status,
        currency: row.currency,
        managementFeeBps: row.managementFeeBps,
      },
      quotes: quotes.map((q) => ({
        id: q.id,
        version: q.version,
        status: q.status,
        amountMinor: q.amountMinor,
        deliveryDays: q.deliveryDays,
        createdAt: q.createdAt,
        acceptedAt: q.acceptedAt,
        items: q.items.map((item) => ({
          id: item.id,
          description: item.description,
          amountMinor: item.amountMinor,
          extraDays: item.extraDays,
        })),
      })),
      amendments: amendments.map((a) => ({
        id: a.id,
        status: a.status,
        note: a.note,
        addItems: a.addItems,
        deltaMinor: a.deltaMinor,
        newAmountMinor: a.newAmountMinor,
        extraDays: a.extraDays,
        createdAt: a.createdAt,
      })),
      payments: paymentViews,
    };
  }),

  clientAcceptQuote: publicProcedure
    .input(z.object({ token: z.string().min(1), quoteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const projectId = await projectIdFromToken(ctx.auth, input.token);
      return acceptQuote(ctx.db, { projectId, quoteId: input.quoteId });
    }),

  clientAcceptAmendment: publicProcedure
    .input(z.object({ token: z.string().min(1), amendmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const projectId = await projectIdFromToken(ctx.auth, input.token);
      return acceptAmendment(ctx.db, { projectId, amendmentId: input.amendmentId });
    }),

  clientDeclineAmendment: publicProcedure
    .input(z.object({ token: z.string().min(1), amendmentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const projectId = await projectIdFromToken(ctx.auth, input.token);
      await declineAmendment(ctx.db, { projectId, amendmentId: input.amendmentId });
    }),
});
