import { canOpenStore, hasStoreWideRole, storeSlugProblem, validateStoreSlug } from "@jendal-workspace/core";
import { resendOrderEmail } from "@jendal-workspace/api/use-cases/orders";
import { isStoreSlugTaken, listOrganizationsWithStores } from "@jendal-workspace/db/repositories/stores";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { storeProcedure } from "../store-procedure";
import { organizationForNewTeam, toTRPCError } from "../team-creation";

const slugInput = z.string().max(100);

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

  // Backlog row 15: the admin's Resend button on the order view.
  resendOrderEmail: storeProcedure
    .input(z.object({ orderId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.role !== "owner" && ctx.role !== "admin" && ctx.servicesTeamRole !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only team admins can resend order emails." });
      }
      const sent = await resendOrderEmail({ db: ctx.db, email: ctx.email }, { orderId: input.orderId, teamId: ctx.store.id });
      return { sent };
    }),

  checkSlug: protectedProcedure.input(z.object({ slug: slugInput })).query(async ({ ctx, input }) => {
    const result = validateStoreSlug(input.slug);
    if (!result.ok) return { status: "invalid", reason: result.reason } as const;
    if (await isStoreSlugTaken(ctx.db, result.slug)) return { status: "taken", slug: result.slug } as const;
    return { status: "available", slug: result.slug } as const;
  }),

  // Spec §6.1: the store goes into the first organization the user can create stores in, or a new one.
  create: protectedProcedure
    .input(z.object({ name: z.string().trim().min(2).max(80), slug: slugInput }))
    .mutation(async ({ ctx, input }) => {
      const slug = validateStoreSlug(input.slug);
      if (!slug.ok) throw new TRPCError({ code: "BAD_REQUEST", message: storeSlugProblem(slug.reason) });
      // Checked before a workspace may be created; the createTeam hook still settles a race.
      if (await isStoreSlugTaken(ctx.db, slug.slug)) {
        throw new TRPCError({ code: "CONFLICT", message: storeSlugProblem("taken") });
      }

      try {
        const organizationId = await organizationForNewTeam(ctx, input.name);
        // createTeam runs the slug and product hooks; if it fails, the organization stays for the retry.
        await ctx.auth.api.createTeam({
          body: { name: input.name, organizationId, slug: slug.slug, product: "store" },
          headers: ctx.headers,
        });
        return { slug: slug.slug };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
