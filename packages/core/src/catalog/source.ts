// Port for an external product catalog (Channel3 in v1). Adapters live outside core.
export type SourceImage = { url: string; cleanedUrl: string | null; altText: string | null; isMain: boolean };

export type SourceOffer = { retailer: string; price: number; currency: string; inStock: boolean };

export type SourceVariantOption = { name: string; values: Array<{ label: string; exists: boolean }> };

export type SourceProduct = {
  id: string;
  title: string;
  description: string | null;
  brands: string[];
  images: SourceImage[];
  category: string | null;
  variantOptions: SourceVariantOption[];
  offers: SourceOffer[];
};

// "not_found" and "no_match" both mean the merchant gets an empty form; "unavailable" means try again later.
export type SourceErrorKind = "not_found" | "no_match" | "unavailable";

export class SourceError extends Error {
  constructor(
    readonly kind: SourceErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "SourceError";
  }
}

export interface ProductSource {
  lookupByUrl(url: string): Promise<SourceProduct>;
  searchByImage(input: { base64Image: string; limit: number }): Promise<SourceProduct[]>;
  getProduct(id: string): Promise<SourceProduct>;
  similarProducts(input: { productId: string; currency: string; limit: number }): Promise<SourceProduct[]>;
  searchProducts(input: { query: string; currency: string; limit: number }): Promise<SourceProduct[]>;
}

export type SourceMatch = { productId: string; title: string; brand: string | null; imageUrl: string | null };

export function toSourceMatch(product: SourceProduct): SourceMatch {
  return {
    productId: product.id,
    title: product.title,
    brand: product.brands[0] ?? null,
    imageUrl: product.images.find((image) => image.isMain)?.url ?? product.images[0]?.url ?? null,
  };
}
