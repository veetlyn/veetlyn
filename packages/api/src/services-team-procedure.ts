import { canServicesTeam, effectiveMemberAccess, type HideableArea, type ServicesTeamAction, type ServicesTeamRole } from "@jendal-workspace/core";
import { findServicesTeamBySlug, getMemberAccess, servicesTeamRoleFor } from "@jendal-workspace/db/repositories/services-teams";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure } from "./index";

// A services team the caller has no role in is reported exactly like a missing one, so slugs do not leak.
export const servicesTeamProcedure = protectedProcedure
  .input(z.object({ teamSlug: z.string().trim().toLowerCase().min(1) }))
  .use(async ({ ctx, input, next }) => {
    const team = await findServicesTeamBySlug(ctx.db, input.teamSlug);
    if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
    const role = await servicesTeamRoleFor(ctx.db, team.id, ctx.session.user.id);
    if (!role) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
    const access = effectiveMemberAccess(role, await getMemberAccess(ctx.db, { teamId: team.id, userId: ctx.session.user.id }));
    return next({ ctx: { servicesTeam: team, servicesTeamRole: role, memberAccess: access } });
  });

export function servicesAreaProcedure(area: HideableArea) {
  return servicesTeamProcedure.use(({ ctx, next }) => {
    if (ctx.memberAccess.hidden.includes(area)) throw new TRPCError({ code: "FORBIDDEN", message: "This page is not available to you." });
    return next();
  });
}

export function requireAction(role: ServicesTeamRole, action: ServicesTeamAction, message: string): void {
  if (!canServicesTeam(role, action)) throw new TRPCError({ code: "FORBIDDEN", message });
}
