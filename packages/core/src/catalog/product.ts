export type ProductStatus = "draft" | "published";

export type VariantOption = { name: string; value: string };

export type VariantDraft = {
  id?: string;
  options: VariantOption[];
  sku: string;
  priceMinor: number;
  stock: number;
};

export type ProductImageDraft = {
  id?: string;
  imageKey?: string;
  sourceUrl?: string;
  alt: string;
};

export type ProductDraft = {
  title: string;
  description: string;
  brand: string;
  category: string;
  chargeTax: boolean;
  requiresShipping: boolean;
  variants: VariantDraft[];
  images: ProductImageDraft[];
};

export const MAX_VARIANTS = 100;
export const MAX_IMAGES = 20;
export const MAX_OPTIONS_PER_VARIANT = 5;
export const MAX_PRICE_MINOR = 99_999_999;
export const MAX_STOCK = 1_000_000;

export type ProductProblem = { field: string; message: string };

export class SkuTakenError extends Error {
  constructor() {
    super("That SKU is already in use in this store.");
    this.name = "SkuTakenError";
  }
}

function isIntegerIn(value: number, max: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= max;
}

// The same rules run in the browser before submit and in the API as a backstop.
export function validateProductDraft(draft: ProductDraft): ProductProblem[] {
  const problems: ProductProblem[] = [];
  if (!draft.title.trim()) problems.push({ field: "title", message: "Add a title." });
  else if (draft.title.length > 200) problems.push({ field: "title", message: "Keep the title under 200 characters." });
  if (draft.description.length > 5_000) {
    problems.push({ field: "description", message: "Keep the description under 5,000 characters." });
  }
  if (draft.brand.length > 120) problems.push({ field: "brand", message: "Keep the brand under 120 characters." });
  if (draft.category.length > 120) {
    problems.push({ field: "category", message: "Keep the category under 120 characters." });
  }

  if (draft.variants.length === 0) problems.push({ field: "variants", message: "Add at least one variant." });
  if (draft.variants.length > MAX_VARIANTS) {
    problems.push({ field: "variants", message: `A product can have up to ${MAX_VARIANTS} variants.` });
  }
  const seenSkus = new Set<string>();
  for (const variant of draft.variants) {
    if (variant.options.length > MAX_OPTIONS_PER_VARIANT) {
      problems.push({ field: "variants", message: `A variant can have up to ${MAX_OPTIONS_PER_VARIANT} options.` });
    }
    for (const option of variant.options) {
      if (!option.name.trim() || !option.value.trim() || option.name.length > 60 || option.value.length > 120) {
        problems.push({ field: "variants", message: "Every option needs a name and a value." });
        break;
      }
    }
    const sku = variant.sku.trim();
    if (sku.length > 64) problems.push({ field: "variants", message: "Keep the SKU under 64 characters." });
    if (sku) {
      const key = sku.toLowerCase();
      if (seenSkus.has(key)) problems.push({ field: "variants", message: `SKU "${sku}" is used twice.` });
      seenSkus.add(key);
    }
    if (!isIntegerIn(variant.priceMinor, MAX_PRICE_MINOR)) {
      problems.push({ field: "variants", message: "Enter a valid price." });
    }
    if (!isIntegerIn(variant.stock, MAX_STOCK)) {
      problems.push({ field: "variants", message: "Enter a valid stock quantity." });
    }
  }

  if (draft.images.length > MAX_IMAGES) {
    problems.push({ field: "images", message: `A product can have up to ${MAX_IMAGES} images.` });
  }
  for (const image of draft.images) {
    if (!image.imageKey && !image.sourceUrl) {
      problems.push({ field: "images", message: "Add every image again before saving." });
      break;
    }
  }
  return problems;
}

// Publishing adds one rule on top of the draft rules: something must be for sale at a real price.
export function publishProblems(draft: ProductDraft): ProductProblem[] {
  const problems = validateProductDraft(draft);
  if (problems.length > 0) return problems;
  if (!draft.variants.some((variant) => variant.priceMinor > 0)) {
    return [{ field: "variants", message: "Set a price above zero before publishing." }];
  }
  return [];
}
