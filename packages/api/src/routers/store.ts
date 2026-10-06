import { canOpenStore, hasStoreWideRole } from "@jendal-workspace/core";
import { listOrganizationsWithStores } from "@jendal-workspace/db/repositories/stores";

import { protectedProcedure, router } from "../index";
import { storeProcedure } from "../store-procedure";

export const storeRouter = router({
  listMine: protectedProcedure.query(async ({ ctx }) => {
    const organizations = await listOrganizationsWithStores(ctx.db, ctx.session.user.id);
    return organizations.map(({ organization, role, stores }) => ({
      id: organization.id,
      name: organization.name,
      role,
      // Mirrors Better Auth's default team:create permission (owner and admin).
      canCreateStores: hasStoreWideRole(role),
      stores: stores.filter((s) => canOpenStore({ role, isTeamMember: s.isTeamMember })).map((s) => s.store),
    }));
  }),

  get: storeProcedure.query(({ ctx }) => ({ ...ctx.store, role: ctx.role })),
});
