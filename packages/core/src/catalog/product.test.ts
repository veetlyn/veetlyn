import { describe, expect, it } from "vitest";

import { MAX_IMAGES, MAX_VARIANTS, publishProblems, validateProductDraft, type ProductDraft } from "./product";

function validDraft(): ProductDraft {
  return {
    title: "Desk lamp",
    description: "A lamp.",
    brand: "Acme",
    category: "Lighting",
    chargeTax: true,
    requiresShipping: true,
    variants: [{ options: [], sku: "LAMP-1", priceMinor: 4200, stock: 8 }],
    images: [{ imageKey: "stores/store-1/images/a.png", alt: "" }],
  };
}

describe("validateProductDraft", () => {
  it("accepts a valid draft", () => {
    expect(validateProductDraft(validDraft())).toEqual([]);
  });

  it("requires a title of at most 200 characters", () => {
    expect(validateProductDraft({ ...validDraft(), title: "  " })).toEqual([
      { field: "title", message: "Add a title." },
    ]);
    expect(validateProductDraft({ ...validDraft(), title: "x".repeat(201) })).toEqual([
      { field: "title", message: "Keep the title under 200 characters." },
    ]);
  });

  it("caps the description, brand and category lengths", () => {
    expect(validateProductDraft({ ...validDraft(), description: "x".repeat(5001) })[0]?.message).toBe(
      "Keep the description under 5,000 characters.",
    );
    expect(validateProductDraft({ ...validDraft(), brand: "x".repeat(121) })[0]?.message).toBe(
      "Keep the brand under 120 characters.",
    );
    expect(validateProductDraft({ ...validDraft(), category: "x".repeat(121) })[0]?.message).toBe(
      "Keep the category under 120 characters.",
    );
  });

  it("requires between 1 and 100 variants", () => {
    expect(validateProductDraft({ ...validDraft(), variants: [] })).toEqual([
      { field: "variants", message: "Add at least one variant." },
    ]);
    const many = Array.from({ length: MAX_VARIANTS + 1 }, () => ({ options: [], sku: "", priceMinor: 1, stock: 0 }));
    expect(validateProductDraft({ ...validDraft(), variants: many })).toEqual([
      { field: "variants", message: "A product can have up to 100 variants." },
    ]);
  });

  it("validates option count and content", () => {
    const options = Array.from({ length: 6 }, (_, i) => ({ name: `Option ${i}`, value: "x" }));
    const draft = { ...validDraft(), variants: [{ options, sku: "", priceMinor: 1, stock: 0 }] };
    expect(validateProductDraft(draft)[0]?.message).toBe("A variant can have up to 5 options.");

    const empty = { ...validDraft(), variants: [{ options: [{ name: "", value: "Red" }], sku: "", priceMinor: 1, stock: 0 }] };
    expect(validateProductDraft(empty)[0]?.message).toBe("Every option needs a name and a value.");
  });

  it("rejects duplicate SKUs within the product and SKUs over 64 characters", () => {
    const variant = { options: [], sku: "DUP", priceMinor: 1, stock: 0 };
    expect(validateProductDraft({ ...validDraft(), variants: [variant, variant] })[0]?.message).toBe(
      'SKU "DUP" is used twice.',
    );
    const long = { ...validDraft(), variants: [{ options: [], sku: "x".repeat(65), priceMinor: 1, stock: 0 }] };
    expect(validateProductDraft(long)[0]?.message).toBe("Keep the SKU under 64 characters.");
  });

  it("validates price and stock", () => {
    const variant = { options: [], sku: "", priceMinor: -1, stock: 0 };
    expect(validateProductDraft({ ...validDraft(), variants: [variant] })[0]?.message).toBe("Enter a valid price.");
    const badStock = { options: [], sku: "", priceMinor: 1, stock: 1.5 };
    expect(validateProductDraft({ ...validDraft(), variants: [badStock] })[0]?.message).toBe(
      "Enter a valid stock quantity.",
    );
  });

  it("caps the image count and requires a key or source URL per image", () => {
    const images = Array.from({ length: MAX_IMAGES + 1 }, () => ({ imageKey: "stores/s1/images/a.png", alt: "" }));
    expect(validateProductDraft({ ...validDraft(), images })[0]?.message).toBe("A product can have up to 20 images.");
    expect(validateProductDraft({ ...validDraft(), images: [{ alt: "" }] })[0]?.message).toBe(
      "Add every image again before saving.",
    );
  });
});

describe("publishProblems", () => {
  it("requires a priced variant before publishing", () => {
    const free = { ...validDraft(), variants: [{ options: [], sku: "", priceMinor: 0, stock: 3 }] };
    expect(publishProblems(free)).toEqual([{ field: "variants", message: "Set a price above zero before publishing." }]);
    expect(publishProblems(validDraft())).toEqual([]);
  });

  it("reports draft problems first", () => {
    expect(publishProblems({ ...validDraft(), title: "" })[0]?.message).toBe("Add a title.");
  });
});
