import { MAX_QUOTE_ITEMS } from "@jendal-workspace/core";
import {
  findProjectById,
  listProjectAmendments,
  listProjectDeliveries,
  listProjectPayments,
  listProjectQuotes,
  listTeamProjects,
} from "@jendal-workspace/db/repositories/projects";
import { canSeeProject, type QuotingMode, type ServicesTeamRole } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import { listDeliveryFiles } from "@jendal-workspace/db/repositories/files";
import { getServicesTeamSettings, listServicesTeamMembers } from "@jendal-workspace/db/repositories/services-teams";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { linkSecret, signClientLink, signPayLink, verifyClientLink } from "../client-links";
import { publicProcedure, router } from "../index";
import { servicesTeamProcedure } from "../services-team-procedure";
import {
  acceptAmendment,
  acceptDelivery,
  acceptQuote,
  addQuote,
  assignFreelancer,
  declineAmendment,
  deliveryFileUrl,
  proposeAmendment,
  requestChanges,
  startDeliveryUpload,
  startProject,
  submitDelivery,
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

type TeamViewer = {
  db: Database;
  servicesTeam: { id: string };
  servicesTeamRole: ServicesTeamRole;
  session: { user: { id: string } };
};

// A project the caller may not see is reported exactly like a missing one.
async function requireVisibleProject(ctx: TeamViewer, projectId: string) {
  const [settings, projects] = await Promise.all([
    getServicesTeamSettings(ctx.db, ctx.servicesTeam.id),
    listTeamProjects(ctx.db, ctx.servicesTeam.id),
  ]);
  const row = projects.find((p) => p.id === projectId);
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
  return { row, settings };
}

// The storage key stays server-side; pages get the name and size, and a signed link on request.
async function withDeliveryFiles<T extends { id: string }>(
  db: Database,
  deliveries: T[],
): Promise<(T & { file: { name: string; sizeBytes: number } | null })[]> {
  const files = await listDeliveryFiles(db, deliveries.map((d) => d.id));
  const byDelivery = new Map(files.map((f) => [f.deliveryId, { name: f.fileName, sizeBytes: f.sizeBytes }]));
  return deliveries.map((d) => ({ ...d, file: byDelivery.get(d.id) ?? null }));
}

function teamActor(ctx: TeamViewer) {
  return { teamId: ctx.servicesTeam.id, role: ctx.servicesTeamRole, actorId: ctx.session.user.id };
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
    const { row, settings } = await requireVisibleProject(ctx, input.projectId);
    const [quotes, amendments, payments, deliveries] = await Promise.all([
      listProjectQuotes(ctx.db, row.id),
      listProjectAmendments(ctx.db, row.id),
      listProjectPayments(ctx.db, row.id),
      listProjectDeliveries(ctx.db, row.id),
    ]);
    const clientToken = await signClientLink(linkSecret(ctx.auth), row.id);
    return {
      project: row,
      quotes,
      amendments,
      payments,
      deliveries: await withDeliveryFiles(ctx.db, deliveries),
      clientPath: `/c/${clientToken}`,
      role: ctx.servicesTeamRole,
      quotingMode: settings?.quotingMode ?? "assigned",
      solo: settings?.solo ?? false,
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
        offeringId: z.string().min(1).optional(),
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

  deliveryUploadStart: servicesTeamProcedure
    .input(projectIdInput.extend({ fileName: z.string().min(1).max(1_000), sizeBytes: z.number().int().nonnegative() }))
    .mutation(async ({ ctx, input }) => {
      return startDeliveryUpload(ctx.db, ctx.files, teamActor(ctx), input);
    }),

  deliver: servicesTeamProcedure
    // Abuse caps only: the use-case trims and gives the friendly length messages.
    .input(
      projectIdInput.extend({
        note: z.string().max(10_000).default(""),
        link: z.string().max(10_000).default(""),
        fileUploadId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return submitDelivery(ctx.db, ctx.files, teamActor(ctx), input);
    }),

  deliveryFileUrl: servicesTeamProcedure
    .input(projectIdInput.extend({ deliveryId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { row } = await requireVisibleProject(ctx, input.projectId);
      return deliveryFileUrl(ctx.db, ctx.files, { projectId: row.id, deliveryId: input.deliveryId });
    }),

  // The client project page (services spec §5.2): signed link, no account. Internal user ids
  // (freelancerId, authorId, proposedById) and the PayPal ids stay server-side; the link holder
  // sees only what the page renders.
  clientGet: publicProcedure.input(z.object({ token: z.string().min(1) })).query(async ({ ctx, input }) => {
    const projectId = await projectIdFromToken(ctx.auth, input.token);
    const row = await findProjectById(ctx.db, projectId);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "This link is not valid." });
    const [quotes, amendments, payments, deliveries] = await Promise.all([
      listProjectQuotes(ctx.db, projectId),
      listProjectAmendments(ctx.db, projectId),
      listProjectPayments(ctx.db, projectId),
      listProjectDeliveries(ctx.db, projectId),
    ]);
    const secret = linkSecret(ctx.auth);
    const paymentViews = await Promise.all(
      payments.map(async (p) => ({
        id: p.id,
        kind: p.kind,
        status: p.status,
        amountMinor: p.amountMinor,
        lines: p.lines,
        createdAt: p.createdAt,
        // PayPal holds a capture it has not finished; the id itself stays server-side.
        processing: p.status === "pending" && p.paypalCaptureId !== null,
        // Pending and failed payments can be paid; the pay link names the payment, never the amount (§5.4).
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
        finalPriceMinor: row.finalPriceMinor,
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
      deliveries: await withDeliveryFiles(
        ctx.db,
        deliveries.map((d) => ({
          id: d.id,
          status: d.status,
          note: d.note,
          link: d.link,
          clientNote: d.clientNote,
          createdAt: d.createdAt,
          decidedAt: d.decidedAt,
        })),
      ),
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

  clientRequestChanges: publicProcedure
    .input(z.object({ token: z.string().min(1), deliveryId: z.string().uuid(), note: z.string().max(10_000) }))
    .mutation(async ({ ctx, input }) => {
      const projectId = await projectIdFromToken(ctx.auth, input.token);
      await requestChanges(ctx.db, { projectId, deliveryId: input.deliveryId, note: input.note });
    }),

  clientDeliveryFileUrl: publicProcedure
    .input(z.object({ token: z.string().min(1), deliveryId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const projectId = await projectIdFromToken(ctx.auth, input.token);
      return deliveryFileUrl(ctx.db, ctx.files, { projectId, deliveryId: input.deliveryId });
    }),

  clientAcceptDelivery: publicProcedure
    .input(z.object({ token: z.string().min(1), deliveryId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const projectId = await projectIdFromToken(ctx.auth, input.token);
      return acceptDelivery(ctx.db, { projectId, deliveryId: input.deliveryId });
    }),
});
