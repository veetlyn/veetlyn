import { canOpenStore, hasStoreWideRole, storeSlugProblem, validateStoreSlug } from "@jendal-workspace/core";
import { isStoreSlugTaken, listOrganizationsWithStores } from "@jendal-workspace/db/repositories/stores";
import { TRPCError } from "@trpc/server";
import { APIError } from "better-auth/api";
import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { storeProcedure } from "../store-procedure";

const slugInput = z.string().max(100);

function toTRPCError(error: unknown): unknown {
  if (!(error instanceof APIError)) return error;
  const code = error.status === "CONFLICT" ? "CONFLICT" : error.status === "FORBIDDEN" ? "FORBIDDEN" : "BAD_REQUEST";
  return new TRPCError({ code, message: error.body?.message ?? error.message, cause: error });
}

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

      try {
        const organizations = await listOrganizationsWithStores(ctx.db, ctx.session.user.id);
        let organizationId = organizations.find((o) => hasStoreWideRole(o.role))?.organization.id;
        if (!organizationId) {
          // The organization slug is never shown; stores carry the public address.
          const created = await ctx.auth.api.createOrganization({
            body: { name: input.name, slug: `org-${crypto.randomUUID()}` },
            headers: ctx.headers,
          });
          if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not create the organization." });
          organizationId = created.id;
        }
        // createTeam runs the W1-A slug hooks; if it fails, the organization stays for the retry.
        await ctx.auth.api.createTeam({
          body: { name: input.name, organizationId, slug: slug.slug },
          headers: ctx.headers,
        });
        return { slug: slug.slug };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),
});
