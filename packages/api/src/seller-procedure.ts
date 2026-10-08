import { canOpenStore, canServicesTeam, hasStoreWideRole, type StoreRecord } from "@jendal-workspace/core";
import { findServicesTeamBySlug, servicesTeamRoleFor } from "@jendal-workspace/db/repositories/services-teams";
import { findStoreAccess } from "@jendal-workspace/db/repositories/stores";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure } from "./index";

// A store or a services team, opened by any member; canManage is who may publish (store: org owner or admin;
// services team: an admin). A seller the caller cannot open reads as missing, like the other procedures.
// findStoreAccess is null for a store whose organization the caller is not in; the services lookup filters
// product = 'services', so such a store slug still ends in NOT_FOUND.
export const sellerProcedure = protectedProcedure
  .input(z.object({ teamSlug: z.string().trim().toLowerCase().min(1) }))
  .use(async ({ ctx, input, next }) => {
    const notFound = () => new TRPCError({ code: "NOT_FOUND", message: "Seller not found." });
    const storeAccess = await findStoreAccess(ctx.db, { slug: input.teamSlug, userId: ctx.session.user.id });
    if (storeAccess) {
      if (!canOpenStore(storeAccess)) throw notFound();
      return next({ ctx: { seller: storeAccess.store, canManage: hasStoreWideRole(storeAccess.role) } });
    }
    const team = await findServicesTeamBySlug(ctx.db, input.teamSlug);
    if (!team) throw notFound();
    const role = await servicesTeamRoleFor(ctx.db, team.id, ctx.session.user.id);
    if (!role) throw notFound();
    const seller: StoreRecord = { ...team, product: "services" };
    return next({ ctx: { seller, canManage: canServicesTeam(role, "manage_settings") } });
  });
