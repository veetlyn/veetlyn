import {
  MARKET_PRICE_REFRESH_TTL_SECONDS,
  MARKET_PRICE_TTL_SECONDS,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  SkuTakenError,
  SourceError,
  buildProductPrefill,
  collectPricedOffers,
  imageExtensionFor,
  isProductImageKeyOf,
  marketPriceCacheKey,
  marketPriceRefreshKey,
  newProductImageKey,
  publishProblems,
  summarizeMarketPrices,
  toSourceMatch,
  validateProductDraft,
  type ImageDownloader,
  type MarketPriceReport,
  type MarketPriceResult,
  type PricedOffer,
  type ProductDraft,
  type ProductImageStore,
  type ProductPrefill,
  type ProductProblem,
  type ProductSource,
  type SourceMatch,
  type TenantContext,
  type TextCache,
} from "@jendal-workspace/core";
import type { Database } from "@jendal-workspace/db";
import {
  deleteImages,
  deleteVariants,
  getProduct,
  insertImages,
  insertProduct,
  insertVariants,
  listImages,
  listProducts,
  listVariants,
  setProductStatus,
  updateProduct as updateProductRecord,
  type NewImage,
  type ProductImageRow,
  type ProductRow,
  type VariantRow,
} from "@jendal-workspace/db/repositories/catalog";

// Everything the catalog use-cases need from the outside world. `source` is null when
// CHANNEL3_API_KEY is not configured. `currency` is hard-coded to "USD" until the store
// settings workstream lands a per-store currency.
export type CatalogServices = {
  source: ProductSource | null;
  images: ProductImageStore;
  imageDownloader: ImageDownloader;
  textCache: TextCache;
  currency: string;
};

export type ProductInput = ProductDraft & { channel3ProductId?: string | null };

export type ProductDetail = { product: ProductRow; variants: VariantRow[]; images: ProductImageRow[] };

export type ProductSummary = {
  id: string;
  title: string;
  status: "draft" | "published";
  variantCount: number;
  priceLow: number | null;
  priceHigh: number | null;
  totalStock: number;
  imageKey: string | null;
  updatedAt: Date;
};

export class CatalogValidationError extends Error {
  constructor(readonly problems: ProductProblem[]) {
    super(problems[0]?.message ?? "Check the product details.");
    this.name = "CatalogValidationError";
  }
}

// Drizzle wraps driver errors; postgres.js puts the SQLSTATE and constraint name on the cause.
function isSkuConflict(error: unknown): boolean {
  const cause = (error as { cause?: unknown } | null)?.cause;
  if (typeof cause !== "object" || cause === null) return false;
  const { code, constraint_name } = cause as { code?: string; constraint_name?: string };
  return code === "23505" && constraint_name === "uq_variants_store_sku";
}

async function withSkuMapping<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isSkuConflict(error)) throw new SkuTakenError();
    throw error;
  }
}

// Uploaded images keep their key (only if it belongs to this store); Channel3/source images
// are downloaded and copied into our bucket so the catalog never hotlinks them (sponsor spec §3.1).
async function resolveImages(
  tenant: TenantContext,
  services: CatalogServices,
  images: ProductInput["images"],
): Promise<NewImage[]> {
  const resolved: NewImage[] = [];
  for (const image of images.slice(0, MAX_IMAGES)) {
    if (image.imageKey && isProductImageKeyOf(tenant.storeId, image.imageKey)) {
      resolved.push({ imageKey: image.imageKey, alt: image.alt });
      continue;
    }
    if (!image.sourceUrl) continue;
    const downloaded = await services.imageDownloader.download(image.sourceUrl);
    const extension = downloaded ? imageExtensionFor(downloaded.contentType) : null;
    if (!downloaded || !extension || downloaded.bytes.byteLength > MAX_IMAGE_BYTES) continue;
    const key = newProductImageKey(tenant.storeId, extension);
    await services.images.put(key, downloaded.bytes, downloaded.contentType);
    resolved.push({ imageKey: key, alt: image.alt });
  }
  return resolved;
}

function assertValid(input: ProductInput): void {
  const problems = validateProductDraft(input);
  if (problems.length > 0) throw new CatalogValidationError(problems);
}

export async function createProduct(
  db: Database,
  tenant: TenantContext,
  services: CatalogServices,
  input: ProductInput,
): Promise<ProductDetail> {
  assertValid(input);
  const images = await resolveImages(tenant, services, input.images);
  return withSkuMapping(async () => {
    const product = await insertProduct(db, tenant, {
      // Run 4a: the digital path passes "digital"; this Commerce path stays physical.
      kind: "physical",
      title: input.title.trim(),
      description: input.description,
      brand: input.brand,
      category: input.category,
      chargeTax: input.chargeTax,
      requiresShipping: input.requiresShipping,
      channel3ProductId: input.channel3ProductId ?? null,
    });
    await insertVariants(db, tenant, product.id, input.variants);
    await insertImages(db, tenant, product.id, images);
    const detail = await getProductDetail(db, tenant, product.id);
    if (!detail) throw new Error("Product disappeared after insert");
    return detail;
  });
}

export async function updateProduct(
  db: Database,
  tenant: TenantContext,
  productId: string,
  services: CatalogServices,
  input: ProductInput,
): Promise<ProductDetail | null> {
  assertValid(input);
  const existing = await getProduct(db, tenant, productId);
  if (!existing) return null;
  const images = await resolveImages(tenant, services, input.images);
  return withSkuMapping(async () => {
    await updateProductRow(db, tenant, productId, input);
    await deleteVariants(db, tenant, productId);
    await insertVariants(db, tenant, productId, input.variants);
    await deleteImages(db, tenant, productId);
    await insertImages(db, tenant, productId, images);
    return getProductDetail(db, tenant, productId);
  });
}

async function updateProductRow(db: Database, tenant: TenantContext, productId: string, input: ProductInput) {
  return updateProductRecord(db, tenant, productId, {
    title: input.title.trim(),
    description: input.description,
    brand: input.brand,
    category: input.category,
    chargeTax: input.chargeTax,
    requiresShipping: input.requiresShipping,
    channel3ProductId: input.channel3ProductId ?? null,
  });
}

export async function getProductDetail(
  db: Database,
  tenant: TenantContext,
  productId: string,
): Promise<ProductDetail | null> {
  const product = await getProduct(db, tenant, productId);
  if (!product) return null;
  const [variants, images] = await Promise.all([
    listVariants(db, tenant, productId),
    listImages(db, tenant, productId),
  ]);
  return { product, variants, images };
}

// One query per product is fine at admin scale (a handful of rows per store).
export async function listProductSummaries(db: Database, tenant: TenantContext): Promise<ProductSummary[]> {
  const rows = await listProducts(db, tenant);
  const summaries: ProductSummary[] = [];
  for (const product of rows) {
    const [variants, images] = await Promise.all([
      listVariants(db, tenant, product.id),
      listImages(db, tenant, product.id),
    ]);
    const prices = variants.map((variant) => variant.priceMinor).filter((price) => price > 0);
    summaries.push({
      id: product.id,
      title: product.title,
      status: product.status as ProductSummary["status"],
      variantCount: variants.length,
      priceLow: prices.length > 0 ? Math.min(...prices) : null,
      priceHigh: prices.length > 0 ? Math.max(...prices) : null,
      totalStock: variants.reduce((total, variant) => total + variant.stock, 0),
      imageKey: images[0]?.imageKey ?? null,
      updatedAt: product.updatedAt,
    });
  }
  return summaries;
}

export async function publishProduct(
  db: Database,
  tenant: TenantContext,
  productId: string,
  // Kept for call-site uniformity with createProduct/updateProduct; unused, so it carries the
  // noUnusedParameters underscore prefix.
  _services: CatalogServices,
): Promise<ProductDetail | null> {
  const detail = await getProductDetail(db, tenant, productId);
  if (!detail) return null;
  const problems = publishProblems({
    title: detail.product.title,
    description: detail.product.description,
    brand: detail.product.brand,
    category: detail.product.category,
    chargeTax: detail.product.chargeTax,
    requiresShipping: detail.product.requiresShipping,
    // Stored variants carry a null SKU where the draft rules expect an empty string.
    variants: detail.variants.map((variant) => ({
      options: variant.options,
      sku: variant.sku ?? "",
      priceMinor: variant.priceMinor,
      stock: variant.stock,
    })),
    images: detail.images.map((image) => ({ imageKey: image.imageKey, alt: image.alt })),
  });
  if (problems.length > 0) throw new CatalogValidationError(problems);
  await setProductStatus(db, tenant, productId, "published");
  return getProductDetail(db, tenant, productId);
}

export async function unpublishProduct(
  db: Database,
  tenant: TenantContext,
  productId: string,
): Promise<ProductDetail | null> {
  const updated = await setProductStatus(db, tenant, productId, "draft");
  if (!updated) return null;
  return getProductDetail(db, tenant, productId);
}

export type PrefillResult =
  | { status: "ok"; prefill: ProductPrefill; alternatives: SourceMatch[] }
  | { status: "no_match" }
  | { status: "unavailable" };

export type MatchListResult =
  | { status: "ok"; matches: SourceMatch[] }
  | { status: "no_match" }
  | { status: "unavailable" };

export type SinglePrefillResult =
  | { status: "ok"; prefill: ProductPrefill }
  | { status: "no_match" }
  | { status: "unavailable" };

function sourceFailure(error: unknown): "no_match" | "unavailable" | null {
  if (error instanceof SourceError) return error.kind === "unavailable" ? "unavailable" : "no_match";
  return null;
}

async function findAlternatives(source: ProductSource, currency: string, productTitle: string, brand: string, excludeId: string): Promise<SourceMatch[]> {
  try {
    const query = [brand, productTitle].filter(Boolean).join(" ").trim();
    if (!query) return [];
    const results = await source.searchProducts({ query, currency, limit: 6 });
    return results.filter((result) => result.id !== excludeId).slice(0, 5).map(toSourceMatch);
  } catch {
    // Alternatives are a nice-to-have; a failed search must not fail the lookup.
    return [];
  }
}

export async function prefillFromUrl(services: CatalogServices, url: string): Promise<PrefillResult> {
  if (!services.source) return { status: "unavailable" };
  try {
    const product = await services.source.lookupByUrl(url);
    const alternatives = await findAlternatives(
      services.source,
      services.currency,
      product.title,
      product.brands[0] ?? "",
      product.id,
    );
    return { status: "ok", prefill: buildProductPrefill(product), alternatives };
  } catch (error) {
    const failure = sourceFailure(error);
    if (failure) return { status: failure };
    throw error;
  }
}

export async function prefillFromPhoto(services: CatalogServices, base64Image: string): Promise<MatchListResult> {
  if (!services.source) return { status: "unavailable" };
  try {
    const products = await services.source.searchByImage({ base64Image, limit: 10 });
    if (products.length === 0) return { status: "no_match" };
    return { status: "ok", matches: products.map(toSourceMatch) };
  } catch (error) {
    const failure = sourceFailure(error);
    if (failure) return { status: failure };
    throw error;
  }
}

export async function prefillFromMatch(services: CatalogServices, productId: string): Promise<SinglePrefillResult> {
  if (!services.source) return { status: "unavailable" };
  try {
    const product = await services.source.getProduct(productId);
    return { status: "ok", prefill: buildProductPrefill(product) };
  } catch (error) {
    const failure = sourceFailure(error);
    if (failure) return { status: failure };
    throw error;
  }
}

async function fetchMarketOffers(
  source: ProductSource,
  currency: string,
  product: ProductRow,
): Promise<PricedOffer[]> {
  if (product.channel3ProductId) {
    const similar = await source.similarProducts({ productId: product.channel3ProductId, currency, limit: 30 });
    return collectPricedOffers(similar, currency);
  }
  const query = [product.brand, product.title].filter(Boolean).join(" ").trim();
  if (!query) return [];
  const results = await source.searchProducts({ query, currency, limit: 30 });
  return collectPricedOffers(results, currency);
}

export async function getMarketPrice(
  db: Database,
  tenant: TenantContext,
  services: CatalogServices,
  productId: string,
  refresh: boolean,
): Promise<MarketPriceResult | null> {
  const product = await getProduct(db, tenant, productId);
  if (!product) return null;
  if (!services.source) return { status: "unavailable" };

  const cacheKey = marketPriceCacheKey(tenant.storeId, productId);
  const refreshKey = marketPriceRefreshKey(tenant.storeId, productId);
  const cached = await services.textCache.get(cacheKey);
  const canRefresh = (await services.textCache.get(refreshKey)) === null;
  if (cached && !(refresh && canRefresh)) return JSON.parse(cached) as MarketPriceReport;
  if (refresh && canRefresh) await services.textCache.put(refreshKey, "1", MARKET_PRICE_REFRESH_TTL_SECONDS);

  let report: MarketPriceReport;
  try {
    const offers = await fetchMarketOffers(services.source, services.currency, product);
    report = summarizeMarketPrices(offers, services.currency, new Date());
  } catch (error) {
    if (error instanceof SourceError) return { status: "unavailable" };
    throw error;
  }
  await services.textCache.put(cacheKey, JSON.stringify(report), MARKET_PRICE_TTL_SECONDS);
  return report;
}
