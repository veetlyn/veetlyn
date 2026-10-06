import { describe, expect, it } from "vitest";

import { buildProductPrefill } from "./prefill";
import type { SourceProduct } from "./source";

function sourceProduct(overrides: Partial<SourceProduct> = {}): SourceProduct {
  return {
    id: "c3-1",
    title: "Trail Runner",
    description: "A shoe.",
    brands: ["Acme"],
    images: [
      { url: "https://cdn.example.com/back.jpg", cleanedUrl: null, altText: "Back view", isMain: false },
      { url: "https://cdn.example.com/front.jpg", cleanedUrl: "https://cdn.example.com/front-clean.png", altText: null, isMain: true },
    ],
    category: "Running shoes",
    variantOptions: [],
    offers: [],
    ...overrides,
  };
}

describe("buildProductPrefill", () => {
  it("maps the product and puts the main image first, without prices", () => {
    const prefill = buildProductPrefill(sourceProduct());

    expect(prefill).toEqual({
      channel3ProductId: "c3-1",
      title: "Trail Runner",
      description: "A shoe.",
      brand: "Acme",
      category: "Running shoes",
      variants: [{ options: [] }],
      images: [
        { sourceUrl: "https://cdn.example.com/front.jpg", alt: "Trail Runner" },
        { sourceUrl: "https://cdn.example.com/back.jpg", alt: "Back view" },
      ],
    });
  });

  it("builds one variant per existing option combination", () => {
    const prefill = buildProductPrefill(
      sourceProduct({
        variantOptions: [
          { name: "Color", values: [{ label: "Red", exists: true }, { label: "Blue", exists: true }] },
          { name: "Size", values: [{ label: "M", exists: true }, { label: "L", exists: false }] },
        ],
      }),
    );

    expect(prefill.variants).toEqual([
      { options: [{ name: "Color", value: "Red" }, { name: "Size", value: "M" }] },
      { options: [{ name: "Color", value: "Blue" }, { name: "Size", value: "M" }] },
    ]);
  });

  it("falls back to one empty variant when no option has existing values", () => {
    const prefill = buildProductPrefill(
      sourceProduct({ variantOptions: [{ name: "Color", values: [{ label: "Red", exists: false }] }] }),
    );

    expect(prefill.variants).toEqual([{ options: [] }]);
  });

  it("caps the variants at 100", () => {
    const prefill = buildProductPrefill(
      sourceProduct({
        variantOptions: [
          { name: "Color", values: Array.from({ length: 11 }, (_, i) => ({ label: `C${i}`, exists: true })) },
          { name: "Size", values: Array.from({ length: 11 }, (_, i) => ({ label: `S${i}`, exists: true })) },
        ],
      }),
    );

    expect(prefill.variants).toHaveLength(100);
  });

  it("handles missing optional fields", () => {
    const prefill = buildProductPrefill(sourceProduct({ description: null, brands: [], category: null, images: [] }));

    expect(prefill).toMatchObject({ description: "", brand: "", category: "", images: [] });
  });
});
