import { SkuTakenError } from "@jendal-workspace/core";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  CatalogValidationError,
  createProduct,
  getMarketPrice,
  getProductDetail,
  listProductSummaries,
  prefillFromMatch,
  prefillFromPhoto,
  prefillFromUrl,
  publishProduct,
  unpublishProduct,
  updateProduct,
} from "../catalog/service";
import { router } from "../index";
import { storeProcedure } from "../store-procedure";

// Transport-level bounds only; the real rules live in core's validateProductDraft so the
// browser and the API share them.
const variantSchema = z.object({
  options: z.array(z.object({ name: z.string().max(60), value: z.string().max(120) })).max(5),
  sku: z.string().max(64),
  priceMinor: z.number().int().min(0),
  stock: z.number().int().min(0),
});

const imageSchema = z.object({
  imageKey: z.string().max(300).optional(),
  sourceUrl: z.url({ protocol: /^https?$/ }).optional(),
  alt: z.string().max(300),
});

const productInputSchema = z.object({
  title: z.string().max(200),
  description: z.string().max(5_000),
  brand: z.string().max(120),
  category: z.string().max(120),
  chargeTax: z.boolean(),
  requiresShipping: z.boolean(),
  channel3ProductId: z.string().max(120).nullish(),
  variants: z.array(variantSchema).max(100),
  images: z.array(imageSchema).max(20),
});

const idInput = z.object({ id: z.uuid() });

function rethrowAsTrpcError(error: unknown): never {
  if (error instanceof CatalogValidationError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  if (error instanceof SkuTakenError) {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  throw error;
}

function notFound(): never {
  throw new TRPCError({ code: "NOT_FOUND", message: "Product not found." });
}

export const catalogRouter = router({
  list: storeProcedure.query(({ ctx }) => listProductSummaries(ctx.db, ctx.tenant)),

  get: storeProcedure.input(idInput).query(async ({ ctx, input }) => {
    const detail = await getProductDetail(ctx.db, ctx.tenant, input.id);
    if (!detail) notFound();
    return detail;
  }),

  create: storeProcedure.input(productInputSchema).mutation(async ({ ctx, input }) => {
    const { storeSlug: _storeSlug, ...product } = input;
    try {
      return await createProduct(ctx.db, ctx.tenant, ctx.catalog, product);
    } catch (error) {
      rethrowAsTrpcError(error);
    }
  }),

  update: storeProcedure.input(productInputSchema.merge(idInput)).mutation(async ({ ctx, input }) => {
    const { storeSlug: _storeSlug, id, ...product } = input;
    try {
      const detail = await updateProduct(ctx.db, ctx.tenant, id, ctx.catalog, product);
      if (!detail) notFound();
      return detail;
    } catch (error) {
      rethrowAsTrpcError(error);
    }
  }),

  publish: storeProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    try {
      const detail = await publishProduct(ctx.db, ctx.tenant, input.id, ctx.catalog);
      if (!detail) notFound();
      return detail;
    } catch (error) {
      rethrowAsTrpcError(error);
    }
  }),

  unpublish: storeProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const detail = await unpublishProduct(ctx.db, ctx.tenant, input.id);
    if (!detail) notFound();
    return detail;
  }),

  // storeProcedure's input ({ storeSlug }) merges with each procedure's own input (tRPC input merging).
  lookupFromUrl: storeProcedure
    .input(z.object({ url: z.url({ protocol: /^https?$/ }) }))
    .mutation(({ ctx, input }) => prefillFromUrl(ctx.catalog, input.url)),

  lookupFromPhoto: storeProcedure
    .input(z.object({ base64Image: z.string().min(1).max(7_000_000) }))
    .mutation(({ ctx, input }) => prefillFromPhoto(ctx.catalog, input.base64Image)),

  prefillFromMatch: storeProcedure
    .input(z.object({ productId: z.string().min(1).max(120) }))
    .mutation(({ ctx, input }) => prefillFromMatch(ctx.catalog, input.productId)),

  marketPrice: storeProcedure
    .input(z.object({ productId: z.uuid(), refresh: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      const result = await getMarketPrice(ctx.db, ctx.tenant, ctx.catalog, input.productId, input.refresh ?? false);
      if (!result) notFound();
      return result;
    }),
});
