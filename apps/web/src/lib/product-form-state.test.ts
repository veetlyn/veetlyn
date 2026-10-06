import { describe, expect, it } from "vitest";

import { emptyProductForm, productFormToDraft, type ProductFormState } from "./product-form-state";

function formWith(overrides: Partial<ProductFormState>): ProductFormState {
  return { ...emptyProductForm(), ...overrides };
}

describe("emptyProductForm", () => {
  it("starts with one empty variant and no images", () => {
    const form = emptyProductForm();
    expect(form.variants).toEqual([{ options: [], sku: "", price: "", stock: "" }]);
    expect(form.images).toEqual([]);
    expect(form.chargeTax).toBe(true);
    expect(form.requiresShipping).toBe(true);
    expect(form.rightsConfirmed).toBe(false);
    expect(form.channel3ProductId).toBeNull();
  });
});

describe("productFormToDraft", () => {
  it("converts price and stock text into minor units and counts", () => {
    const draft = productFormToDraft(
      formWith({
        title: "Lamp",
        variants: [{ options: [{ name: "Color", value: "Red" }], sku: "LAMP-RED", price: "42.50", stock: "8" }],
      }),
    );

    expect(draft.variants).toEqual([
      { options: [{ name: "Color", value: "Red" }], sku: "LAMP-RED", priceMinor: 4250, stock: 8 },
    ]);
  });

  it("marks unparseable prices and stock as invalid so core validation rejects them", () => {
    const draft = productFormToDraft(
      formWith({ variants: [{ options: [], sku: "", price: "not a price", stock: "1.5" }] }),
    );

    expect(draft.variants[0]?.priceMinor).toBe(-1);
    expect(draft.variants[0]?.stock).toBe(-1);
  });

  it("drops the image preview URLs and keeps keys and source URLs", () => {
    const draft = productFormToDraft(
      formWith({
        images: [
          { imageKey: "stores/s1/images/a.png", alt: "", previewUrl: "/api/catalog/images/stores/s1/images/a.png" },
          { sourceUrl: "https://cdn.example.com/b.jpg", alt: "back", previewUrl: "https://cdn.example.com/b.jpg" },
        ],
      }),
    );

    expect(draft.images).toEqual([
      { imageKey: "stores/s1/images/a.png", alt: "" },
      { sourceUrl: "https://cdn.example.com/b.jpg", alt: "back" },
    ]);
  });

  it("needs the rights confirmation only for imported products", () => {
    expect(productFormToDraft(formWith({})).channel3ProductId).toBeNull();
    const imported = formWith({ channel3ProductId: "c3-1" });
    expect(imported.rightsConfirmed).toBe(false);
  });
});
