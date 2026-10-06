import { MAX_QUOTE_ITEMS } from "@jendal-workspace/core";
import {
  listProjectAmendments,
  listProjectPayments,
  listProjectQuotes,
  listTeamProjects,
} from "@jendal-workspace/db/repositories/projects";
import { canSeeProject, type QuotingMode } from "@jendal-workspace/core";
import { getServicesTeamSettings } from "@jendal-workspace/db/repositories/services-teams";
import { user } from "@jendal-workspace/db/schema/auth";
import { servicesTeamMember } from "@jendal-workspace/db/schema/services-teams";
import { asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { signClientLink } from "../client-links";
import { router } from "../index";
import { servicesTeamProcedure } from "../services-team-procedure";
import { addQuote, assignFreelancer, startProject } from "../use-cases/projects";

const quoteItemInput = z.object({
  description: z.string().trim().min(1).max(200),
  amountMinor: z.number().int().positive(),
  extraDays: z.number().int().min(0).max(365).default(0),
});

const projectIdInput = z.object({ projectId: z.string().uuid() });

// The client link token is signed with the Better Auth secret (see client-links.ts).
function clientLinkSecret(auth: { options: Record<string, unknown> }): string {
  const secret = auth.options.secret;
  if (typeof secret !== "string" || secret.length === 0) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The client link secret is not configured." });
  }
  return secret;
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
    const clientToken = await signClientLink(clientLinkSecret(ctx.auth), row.id);
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
    return ctx.db
      .select({ id: user.id, name: user.name, email: user.email, role: servicesTeamMember.role })
      .from(servicesTeamMember)
      .innerJoin(user, eq(user.id, servicesTeamMember.userId))
      .where(eq(servicesTeamMember.teamId, ctx.servicesTeam.id))
      .orderBy(asc(user.name), asc(user.id));
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
      const clientToken = await signClientLink(clientLinkSecret(ctx.auth), projectId);
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
});
