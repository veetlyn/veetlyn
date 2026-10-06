import { MAX_IMAGES, MAX_VARIANTS, type VariantOption } from "./product";
import type { SourceProduct } from "./source";

// Everything Channel3 can fill for the merchant. Prices and stock are never pre-filled (sponsor spec §3.1).
export type ProductPrefill = {
  channel3ProductId: string;
  title: string;
  description: string;
  brand: string;
  category: string;
  variants: Array<{ options: VariantOption[] }>;
  images: Array<{ sourceUrl: string; alt: string }>;
};

function prefillVariants(product: SourceProduct): Array<{ options: VariantOption[] }> {
  const axes = product.variantOptions
    .map((option) => ({ name: option.name, values: option.values.filter((value) => value.exists) }))
    .filter((option) => option.values.length > 0);
  if (axes.length === 0) return [{ options: [] }];

  let combinations: VariantOption[][] = [[]];
  for (const axis of axes) {
    const next: VariantOption[][] = [];
    for (const combination of combinations) {
      for (const value of axis.values) {
        next.push([...combination, { name: axis.name, value: value.label }]);
      }
    }
    combinations = next;
    if (combinations.length > MAX_VARIANTS) break;
  }
  return combinations.slice(0, MAX_VARIANTS).map((options) => ({ options }));
}

export function buildProductPrefill(product: SourceProduct): ProductPrefill {
  const images = [...product.images].sort((a, b) => Number(b.isMain) - Number(a.isMain));
  return {
    channel3ProductId: product.id,
    title: product.title,
    description: product.description ?? "",
    brand: product.brands[0] ?? "",
    category: product.category ?? "",
    variants: prefillVariants(product),
    images: images.slice(0, MAX_IMAGES).map((image) => ({ sourceUrl: image.url, alt: image.altText ?? product.title })),
  };
}
