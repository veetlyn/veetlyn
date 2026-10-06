import { hasStoreWideRole, type StoreRecord } from "@jendal-workspace/core";
import { findTeamAccess } from "@jendal-workspace/db/repositories/teams";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { Context } from "../context";
import { protectedProcedure, router } from "../index";
import {
  getPayPalOnboardingView,
  type PayPalOnboardingDeps,
  refreshPayPalOnboarding,
  startPayPalOnboarding,
} from "../paypal/onboarding";

const teamIdInput = z.object({ teamId: z.string().min(1).max(64) });

type AuthedContext = Context & { session: NonNullable<Context["session"]> };

function requirePayPal(ctx: AuthedContext): PayPalOnboardingDeps {
  if (!ctx.paypal) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "PayPal is not configured on this server." });
  }
  return { db: ctx.db, ...ctx.paypal };
}

// Connecting PayPal is an admin power (services spec §4.1): the workspace's owners and admins.
// Same leak rule as storeProcedure: a team the caller cannot administer reads as missing.
async function requireTeamAdmin(ctx: AuthedContext, teamId: string): Promise<StoreRecord> {
  const access = await findTeamAccess(ctx.db, { teamId, userId: ctx.session.user.id });
  if (!access || !hasStoreWideRole(access.role)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
  }
  return access.team;
}

export const paypalRouter = router({
  startOnboarding: protectedProcedure.input(teamIdInput).mutation(async ({ ctx, input }) => {
    const team = await requireTeamAdmin(ctx, input.teamId);
    return startPayPalOnboarding(requirePayPal(ctx), team);
  }),

  onboardingStatus: protectedProcedure
    .input(teamIdInput.extend({ refresh: z.boolean().default(false) }))
    .query(async ({ ctx, input }) => {
      const team = await requireTeamAdmin(ctx, input.teamId);
      const deps = requirePayPal(ctx);
      return input.refresh ? refreshPayPalOnboarding(deps, team) : getPayPalOnboardingView(deps, team);
    }),
});
