import { listConnectedApps, revokeOAuthGrants } from "@jendal-workspace/db/repositories/oauth-grants";
import { z } from "zod";

import { protectedProcedure, router } from "../index";

// The AI clients (Claude, ChatGPT, others) the user let act for them through Payleor's plugin.
export const connectedAppsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) =>
    (await listConnectedApps(ctx.db, ctx.session.user.id)).map((app) => ({
      clientId: app.clientId,
      name: app.name ?? "An AI client",
      uri: app.uri,
      connectedAt: app.connectedAt?.toISOString() ?? null,
    })),
  ),
  disconnect: protectedProcedure.input(z.object({ clientId: z.string().min(1).max(512) })).mutation(async ({ ctx, input }) => {
    await revokeOAuthGrants(ctx.db, { userId: ctx.session.user.id, clientId: input.clientId });
    return { ok: true as const };
  }),
});
