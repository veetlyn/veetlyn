import { publishProblem, SUSPENDED_SELLER_MESSAGE, type StoreRecord } from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import { countPublishedDigitalProducts } from "@jendal-workspace/db/repositories/catalog";
import { findSellerPage } from "@jendal-workspace/db/repositories/seller-page";
import { countServicesOfferings } from "@jendal-workspace/db/repositories/services-catalog";
import { countPublishedProducts, setTeamStatus } from "@jendal-workspace/db/repositories/stores";
import { TRPCError } from "@trpc/server";

import { router } from "../index";
import { sellerProcedure } from "../seller-procedure";

async function listedCount(db: Database, seller: StoreRecord): Promise<number> {
  if (seller.product === "services") {
    // An active service or a published digital product both count as "listed".
    const [offerings, products] = await Promise.all([
      countServicesOfferings(db, seller.id, { activeOnly: true }),
      countPublishedDigitalProducts(db, seller.id),
    ]);
    return offerings + products;
  }
  return countPublishedProducts(db, seller.id);
}

async function problemFor(db: Database, seller: StoreRecord) {
  const count = await listedCount(db, seller);
  return {
    listedCount: count,
    problem: publishProblem({
      product: seller.product,
      status: seller.status,
      paypalMerchantId: seller.paypalMerchantId,
      listedCount: count,
    }),
  };
}

function forbidUnlessManager(canManage: boolean) {
  if (!canManage) throw new TRPCError({ code: "FORBIDDEN", message: "Only an admin can publish or unpublish." });
}

function suspended() {
  return new TRPCError({ code: "BAD_REQUEST", message: SUSPENDED_SELLER_MESSAGE });
}

export const sellerRouter = router({
  status: sellerProcedure.query(async ({ ctx }) => {
    const { listedCount, problem } = await problemFor(ctx.db, ctx.seller);
    return {
      product: ctx.seller.product,
      status: ctx.seller.status,
      listedCount,
      problem,
      canManage: ctx.canManage,
    };
  }),

  preview: sellerProcedure.query(async ({ ctx }) => {
    const page = await findSellerPage(ctx.db, ctx.seller.id);
    if (!page) throw new TRPCError({ code: "NOT_FOUND", message: "Seller not found." });
    return page;
  }),

  publish: sellerProcedure.mutation(async ({ ctx }) => {
    forbidUnlessManager(ctx.canManage);
    const { problem } = await problemFor(ctx.db, ctx.seller);
    if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
    // Null when the seller was suspended between the read above and this write.
    const updated = await setTeamStatus(ctx.db, { teamId: ctx.seller.id, status: "active" });
    if (!updated) throw suspended();
    await ctx.onTeamStatusChanged?.({ id: ctx.seller.id, slug: updated.slug });
    return { status: "active" as const };
  }),

  unpublish: sellerProcedure.mutation(async ({ ctx }) => {
    forbidUnlessManager(ctx.canManage);
    if (ctx.seller.status === "suspended") throw suspended();
    const updated = await setTeamStatus(ctx.db, { teamId: ctx.seller.id, status: "draft" });
    if (!updated) throw suspended();
    await ctx.onTeamStatusChanged?.({ id: ctx.seller.id, slug: updated.slug });
    return { status: "draft" as const };
  }),
});
