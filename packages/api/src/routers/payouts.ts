import { z } from "zod";

import { router } from "../index";
import { requireAction, servicesTeamProcedure } from "../services-team-procedure";
import {
  getPayoutCredentialsView,
  removeTeamPayoutCredentials,
  requirePayoutServices,
  saveTeamPayoutCredentialsChecked,
} from "../use-cases/payout-credentials";

const SETTINGS_ONLY = "Only an admin can change the team settings.";

export const payoutsRouter = router({
  // The secret is never returned; the admin recognises the app by the end of its client ID.
  credentials: servicesTeamProcedure.query(async ({ ctx }) => {
    requireAction(ctx.servicesTeamRole, "manage_settings", SETTINGS_ONLY);
    return getPayoutCredentialsView(ctx.db, ctx.servicesTeam.id);
  }),

  saveCredentials: servicesTeamProcedure
    .input(z.object({ clientId: z.string().trim().min(1).max(500), clientSecret: z.string().trim().min(1).max(500) }))
    .mutation(async ({ ctx, input }) => {
      requireAction(ctx.servicesTeamRole, "manage_settings", SETTINGS_ONLY);
      const payouts = requirePayoutServices(ctx.payouts);
      return saveTeamPayoutCredentialsChecked(
        { db: ctx.db, payouts },
        { team: ctx.servicesTeam, clientId: input.clientId, clientSecret: input.clientSecret },
      );
    }),

  removeCredentials: servicesTeamProcedure.mutation(async ({ ctx }) => {
    requireAction(ctx.servicesTeamRole, "manage_settings", SETTINGS_ONLY);
    await removeTeamPayoutCredentials(ctx.db, ctx.servicesTeam.id);
    return { removed: true };
  }),
});
