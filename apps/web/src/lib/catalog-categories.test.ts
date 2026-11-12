import { describe, expect, it } from "vitest";

import { categoryDescendantIds, flattenCategories, type CatalogCategory } from "./catalog-categories";

const categories: CatalogCategory[] = [
  { id: "design", name: "Design", parentId: null },
  { id: "logo", name: "Logo", parentId: "design" },
  { id: "brand", name: "Brand", parentId: "logo" },
  { id: "web", name: "Web", parentId: null },
  { id: "landing", name: "Landing pages", parentId: "web" },
];

describe("catalog categories", () => {
  it("flattens a category tree with paths for selects", () => {
    expect(flattenCategories(categories).map((category) => [category.id, category.depth, category.path])).toEqual([
      ["design", 0, "Design"],
      ["logo", 1, "Design / Logo"],
      ["brand", 2, "Design / Logo / Brand"],
      ["web", 0, "Web"],
      ["landing", 1, "Web / Landing pages"],
    ]);
  });

  it("includes descendants when filtering by a parent category", () => {
    expect([...categoryDescendantIds(categories, "design")].sort()).toEqual(["brand", "design", "logo"]);
    expect([...categoryDescendantIds(categories, "logo")].sort()).toEqual(["brand", "logo"]);
  });

  it("does not loop or hide categories when parent data contains a cycle or a missing parent", () => {
    const broken: CatalogCategory[] = [
      { id: "a", name: "A", parentId: "b" },
      { id: "b", name: "B", parentId: "a" },
      { id: "orphan", name: "Orphan", parentId: "missing" },
    ];
    expect(flattenCategories(broken).map((category) => category.id).sort()).toEqual(["a", "b", "orphan"]);
    expect(categoryDescendantIds(broken, "a")).toEqual(new Set(["a", "b"]));
  });
});
