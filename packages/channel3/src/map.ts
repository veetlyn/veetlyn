import type { SourceProduct } from "@jendal-workspace/core";
import type { z } from "zod";

import type { channel3ProductSchema } from "./schemas";

type Channel3Product = z.infer<typeof channel3ProductSchema>;

export function toSourceProduct(product: Channel3Product): SourceProduct {
  return {
    id: product.id,
    title: product.title,
    description: product.description ?? null,
    brands: product.brands.map((brand) => brand.name),
    images: product.images.map((image) => ({
      url: image.url,
      cleanedUrl: image.cleaned_url ?? null,
      altText: image.alt_text ?? null,
      isMain: image.is_main_image ?? false,
    })),
    category: product.category?.title ?? null,
    variantOptions: (product.variants?.options ?? []).map((option) => ({
      name: option.name,
      values: option.values.map((value) => ({ label: value.label, exists: value.exists })),
    })),
    offers: product.offers.map((offer) => ({
      retailer: offer.domain,
      price: offer.price.price,
      currency: offer.price.currency,
      inStock: offer.availability !== "OutOfStock",
    })),
  };
}
