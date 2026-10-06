import type { ProductDraft, VariantOption } from "@jendal-workspace/core";

import { parsePriceInput } from "./money";

export type VariantFormState = { options: VariantOption[]; sku: string; price: string; stock: string };

export type ImageFormState = { imageKey?: string; sourceUrl?: string; alt: string; previewUrl: string };

export type ProductFormState = {
  title: string;
  description: string;
  brand: string;
  category: string;
  chargeTax: boolean;
  requiresShipping: boolean;
  channel3ProductId: string | null;
  variants: VariantFormState[];
  images: ImageFormState[];
  rightsConfirmed: boolean;
};

export function emptyProductForm(): ProductFormState {
  return {
    title: "",
    description: "",
    brand: "",
    category: "",
    chargeTax: true,
    requiresShipping: true,
    channel3ProductId: null,
    variants: [{ options: [], sku: "", price: "", stock: "" }],
    images: [],
    rightsConfirmed: false,
  };
}

export type ProductDraftInput = ProductDraft & { channel3ProductId: string | null };

export function productFormToDraft(form: ProductFormState): ProductDraftInput {
  return {
    title: form.title,
    description: form.description,
    brand: form.brand,
    category: form.category,
    chargeTax: form.chargeTax,
    requiresShipping: form.requiresShipping,
    channel3ProductId: form.channel3ProductId,
    variants: form.variants.map((variant) => ({
      options: variant.options,
      sku: variant.sku,
      priceMinor: parsePriceInput(variant.price) ?? -1,
      stock: /^-?\d+$/.test(variant.stock.trim()) ? Number(variant.stock.trim()) : -1,
    })),
    images: form.images.map((image) => ({ imageKey: image.imageKey, sourceUrl: image.sourceUrl, alt: image.alt })),
  };
}
