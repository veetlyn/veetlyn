import { MAX_QUOTE_ITEMS, QUOTE_REQUEST_LIMITS, type ServicesTeamRole } from "@jendal-workspace/core";
import { listServicesTeamMembers } from "@jendal-workspace/db/repositories/services-teams";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { ActionError, toTRPCError } from "../actions/errors";
import { type LinkSecretSource, linkSecret, signClientLink, verifyClientLink } from "../client-links";
import { publicProcedure, router } from "../index";
import { servicesTeamProcedure } from "../services-team-procedure";
import { refundClient } from "../use-cases/client-refunds";
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
import { getClientProjectView, getTeamProjectView, listVisibleProjects, teamDeliveryFileUrl } from "../use-cases/project-views";
import { createQuoteRequest } from "../use-cases/requests";

const quoteItemInput = z.object({
  description: z.string().trim().min(1).max(200),
  amountMinor: z.number().int().positive(),
  extraDays: z.number().int().min(0).max(365).default(0),
});

const projectIdInput = z.object({ projectId: z.string().uuid() });

// Abuse caps only: the use-case validates and gives the friendly messages.
const requestQuoteInput = z.object({
  slug: z.string().min(1).max(63),
  offeringId: z.string().max(64).nullable(),
  name: z.string().max(QUOTE_REQUEST_LIMITS.maxName + 20),
  email: z.string().max(QUOTE_REQUEST_LIMITS.maxEmail),
  description: z.string().max(QUOTE_REQUEST_LIMITS.maxDescription + 100),
  answers: z
    .array(
      z.object({ question: z.string().max(200), answer: z.string().max(QUOTE_REQUEST_LIMITS.maxAnswer + 100) }),
    )
    .max(10),
  // Honeypot: bots fill the hidden "website" field; a filled field pretends success.
  website: z.string().max(200),
});

async function projectIdFromToken(auth: LinkSecretSource, token: string): Promise<string> {
  const projectId = await verifyClientLink(linkSecret(auth), token);
  if (!projectId) throw new TRPCError({ code: "NOT_FOUND", message: "This link is not valid." });
  return projectId;
}

type TeamViewer = {
  servicesTeam: { id: string };
  servicesTeamRole: ServicesTeamRole;
  session: { user: { id: string } };
};

function teamActor(ctx: TeamViewer) {
  return { teamId: ctx.servicesTeam.id, role: ctx.servicesTeamRole, actorId: ctx.session.user.id };
}

export const projectRouter = router({
  list: servicesTeamProcedure.query(async ({ ctx }) => {
    return listVisibleProjects(ctx.db, teamActor(ctx));
  }),

  get: servicesTeamProcedure.input(projectIdInput).query(async ({ ctx, input }) => {
    return getTeamProjectView({ db: ctx.db, auth: ctx.auth }, teamActor(ctx), input.projectId);
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

  refundClient: servicesTeamProcedure.input(projectIdInput).mutation(async ({ ctx, input }) => {
    return refundClient({ db: ctx.db, paypal: ctx.paypal }, teamActor(ctx), input);
  }),

  deliveryFileUrl: servicesTeamProcedure
    .input(projectIdInput.extend({ deliveryId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return teamDeliveryFileUrl({ db: ctx.db, files: ctx.files }, teamActor(ctx), input);
    }),

  requestQuote: publicProcedure.input(requestQuoteInput).mutation(async ({ ctx, input }) => {
    const ip = ctx.headers.get("cf-connecting-ip")?.trim();
    try {
      return await createQuoteRequest({ db: ctx.db, auth: ctx.auth, email: ctx.email }, { ip }, input);
    } catch (cause) {
      if (cause instanceof ActionError) throw toTRPCError(cause);
      throw cause;
    }
  }),

  clientGet: publicProcedure.input(z.object({ token: z.string().min(1) })).query(async ({ ctx, input }) => {
    const projectId = await projectIdFromToken(ctx.auth, input.token);
    return getClientProjectView({ db: ctx.db, auth: ctx.auth }, projectId);
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
