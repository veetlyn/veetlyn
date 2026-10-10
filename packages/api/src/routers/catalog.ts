import { canServicesTeam, type ServicesTeamRole, SkuTakenError } from "@jendal-workspace/core";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  createDigitalProduct,
  DigitalProductMissing,
  getDigitalProduct,
  listDigitalProducts,
  startProductFileUpload,
  attachProductFile,
  updateDigitalProduct,
  UploadLimitedError,
} from "../catalog/digital";
import { CatalogValidationError } from "../catalog/errors";
import {
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

// Transport-level bounds only; the real rules live in core's validateDigitalProductDraft.
const digitalInputSchema = z.object({
  title: z.string().max(200),
  description: z.string().max(5_000),
  priceMinor: z.number().int().min(0),
});

// Sellers design §5.1: digital products are managed from a seller (services) team, not a store.
type CatalogCtx = { store: { product: string }; servicesTeamRole: ServicesTeamRole | null };

function requireServicesTeam(ctx: CatalogCtx) {
  if (ctx.store.product !== "services") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Digital products are managed from a seller team." });
  }
  requireManageServicesProducts(ctx);
}

// Every other services-team mutation is admin-only (manage_settings); products follow suit.
function requireManageServicesProducts(ctx: CatalogCtx) {
  if (ctx.store.product === "services" && !canServicesTeam(ctx.servicesTeamRole, "manage_settings")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only an admin can manage products." });
  }
}

function requireCommerceStore(ctx: { store: { product: string } }) {
  if (ctx.store.product !== "store") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Physical products are managed from a store." });
  }
}

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
  list: storeProcedure.query(({ ctx }) => {
    requireCommerceStore(ctx);
    return listProductSummaries(ctx.db, ctx.tenant);
  }),

  get: storeProcedure.input(idInput).query(async ({ ctx, input }) => {
    requireCommerceStore(ctx);
    const detail = await getProductDetail(ctx.db, ctx.tenant, input.id);
    if (!detail) notFound();
    return detail;
  }),

  create: storeProcedure.input(productInputSchema).mutation(async ({ ctx, input }) => {
    requireCommerceStore(ctx);
    const { storeSlug: _storeSlug, ...product } = input;
    try {
      return await createProduct(ctx.db, ctx.tenant, ctx.catalog, product);
    } catch (error) {
      rethrowAsTrpcError(error);
    }
  }),

  update: storeProcedure.input(productInputSchema.merge(idInput)).mutation(async ({ ctx, input }) => {
    requireCommerceStore(ctx);
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
    requireManageServicesProducts(ctx);
    try {
      const detail = await publishProduct(ctx.db, ctx.tenant, input.id, ctx.catalog);
      if (!detail) notFound();
      return detail;
    } catch (error) {
      rethrowAsTrpcError(error);
    }
  }),

  unpublish: storeProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    requireManageServicesProducts(ctx);
    const detail = await unpublishProduct(ctx.db, ctx.tenant, input.id);
    if (!detail) notFound();
    return detail;
  }),

  digitalList: storeProcedure.query(({ ctx }) => {
    requireServicesTeam(ctx);
    return listDigitalProducts(ctx.db, ctx.tenant);
  }),

  digitalGet: storeProcedure.input(idInput).query(async ({ ctx, input }) => {
    requireServicesTeam(ctx);
    try {
      return await getDigitalProduct(ctx.db, ctx.tenant, input.id);
    } catch (error) {
      if (error instanceof DigitalProductMissing) notFound();
      throw error;
    }
  }),

  digitalCreate: storeProcedure.input(digitalInputSchema).mutation(async ({ ctx, input }) => {
    requireServicesTeam(ctx);
    const { storeSlug: _storeSlug, ...draft } = input;
    try {
      return await createDigitalProduct(ctx.db, ctx.tenant, draft);
    } catch (error) {
      rethrowAsTrpcError(error);
    }
  }),

  digitalUpdate: storeProcedure.input(digitalInputSchema.merge(idInput)).mutation(async ({ ctx, input }) => {
    requireServicesTeam(ctx);
    const { storeSlug: _storeSlug, id, ...draft } = input;
    try {
      return await updateDigitalProduct(ctx.db, ctx.tenant, id, draft);
    } catch (error) {
      if (error instanceof DigitalProductMissing) notFound();
      rethrowAsTrpcError(error);
    }
  }),

  fileUploadStart: storeProcedure
    .input(z.object({ productId: z.uuid(), fileName: z.string().max(300), sizeBytes: z.number().int().min(0) }))
    .mutation(async ({ ctx, input }) => {
      requireServicesTeam(ctx);
      try {
        return await startProductFileUpload(ctx.db, ctx.files, ctx.tenant, ctx.session.user.id, input);
      } catch (error) {
        if (error instanceof DigitalProductMissing) notFound();
        if (error instanceof UploadLimitedError) {
          throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: error.message });
        }
        rethrowAsTrpcError(error);
      }
    }),

  fileAttach: storeProcedure
    .input(z.object({ productId: z.uuid(), uploadId: z.string().max(64) }))
    .mutation(async ({ ctx, input }) => {
      requireServicesTeam(ctx);
      try {
        return await attachProductFile(ctx.db, ctx.files, ctx.tenant, input);
      } catch (error) {
        if (error instanceof DigitalProductMissing) notFound();
        rethrowAsTrpcError(error);
      }
    }),

  // storeProcedure's input ({ storeSlug }) merges with each procedure's own input (tRPC input merging).
  lookupFromUrl: storeProcedure
    .input(z.object({ url: z.url({ protocol: /^https?$/ }) }))
    .mutation(({ ctx, input }) => {
      requireCommerceStore(ctx);
      return prefillFromUrl(ctx.catalog, input.url);
    }),

  lookupFromPhoto: storeProcedure
    .input(z.object({ base64Image: z.string().min(1).max(7_000_000) }))
    .mutation(({ ctx, input }) => {
      requireCommerceStore(ctx);
      return prefillFromPhoto(ctx.catalog, input.base64Image);
    }),

  prefillFromMatch: storeProcedure
    .input(z.object({ productId: z.string().min(1).max(120) }))
    .mutation(({ ctx, input }) => {
      requireCommerceStore(ctx);
      return prefillFromMatch(ctx.catalog, input.productId);
    }),

  marketPrice: storeProcedure
    .input(z.object({ productId: z.uuid(), refresh: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      requireCommerceStore(ctx);
      const result = await getMarketPrice(ctx.db, ctx.tenant, ctx.catalog, input.productId, input.refresh ?? false);
      if (!result) notFound();
      return result;
    }),
});
