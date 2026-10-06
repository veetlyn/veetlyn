import { findServicesTeamBySlug, servicesTeamRoleFor } from "@jendal-workspace/db/repositories/services-teams";
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
    return next({ ctx: { servicesTeam: team, servicesTeamRole: role } });
  });
