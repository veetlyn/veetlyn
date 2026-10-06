import { canOpenStore, createTenantContext } from "@jendal-workspace/core";
import { findStoreAccess } from "@jendal-workspace/db/repositories/stores";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure } from "./index";

// Spec §4.7: the store comes from the URL. A store the caller cannot open is reported
// exactly like a missing one, so other merchants' slugs do not leak.
export const storeProcedure = protectedProcedure
  .input(z.object({ storeSlug: z.string().trim().toLowerCase().min(1) }))
  .use(async ({ ctx, input, next }) => {
    const access = await findStoreAccess(ctx.db, { slug: input.storeSlug, userId: ctx.session.user.id });
    if (!access || !canOpenStore(access)) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Store not found." });
    }
    return next({
      ctx: {
        store: access.store,
        role: access.role,
        tenant: createTenantContext(access.store, "admin", ctx.environment),
      },
    });
  });
