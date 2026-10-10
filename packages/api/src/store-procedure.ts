import { canOpenStore, createTenantContext, type ServicesTeamRole, type StoreRecord } from "@jendal-workspace/core";
import { findServicesTeamBySlug, servicesTeamRoleFor } from "@jendal-workspace/db/repositories/services-teams";
import { findStoreAccess } from "@jendal-workspace/db/repositories/stores";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure } from "./index";

// Spec §4.7: the store comes from the URL. A store the caller cannot open is reported
// exactly like a missing one, so other merchants' slugs do not leak. Services teams resolve
// too, because their digital products live on the catalog router; procedures that are
// store-only or services-only check ctx.store.product themselves.
// Services teams keep their roles in services_team_member, so their access mirrors
// servicesTeamProcedure, and ctx.role is the services-team role. findStoreAccess is null for a
// store whose organization the caller is not in; the services lookup filters product = 'services',
// so such a store slug still ends in NOT_FOUND.
export const storeProcedure = protectedProcedure
  .input(z.object({ storeSlug: z.string().trim().toLowerCase().min(1) }))
  .use(async ({ ctx, input, next }) => {
    const notFound = () => new TRPCError({ code: "NOT_FOUND", message: "Store not found." });
    const storeAccess = await findStoreAccess(ctx.db, { slug: input.storeSlug, userId: ctx.session.user.id });
    if (storeAccess) {
      if (!canOpenStore(storeAccess)) throw notFound();
      const noServicesRole: ServicesTeamRole | null = null;
      return next({
        ctx: {
          store: storeAccess.store,
          role: storeAccess.role,
          servicesTeamRole: noServicesRole,
          tenant: createTenantContext(storeAccess.store, "admin", ctx.environment),
        },
      });
    }
    const team = await findServicesTeamBySlug(ctx.db, input.storeSlug);
    if (!team) throw notFound();
    const servicesTeamRole = await servicesTeamRoleFor(ctx.db, team.id, ctx.session.user.id);
    if (!servicesTeamRole) throw notFound();
    const store: StoreRecord = { ...team, product: "services" };
    const role: string = servicesTeamRole;
    const servicesRole: ServicesTeamRole | null = servicesTeamRole;
    return next({
      ctx: {
        store,
        role,
        servicesTeamRole: servicesRole,
        tenant: createTenantContext(store, "admin", ctx.environment),
      },
    });
  });
