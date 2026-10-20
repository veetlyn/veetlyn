import { describe, expect, it } from "vitest";

import type { Listing } from "../../content/site/listings";

import { browse } from "./discover";

const l = (p: Partial<Listing>): Listing => ({
  title: "x",
  seller: "s",
  member: false,
  kind: "service",
  done: "people",
  category: "design",
  priceLabel: "$1",
  priceDollars: 1,
  detail: "",
  glyph: "X",
  tone: 1,
  ...p,
});
const items = [
  l({ title: "Logo and brand kit", priceDollars: 400 }),
  l({ title: "Glazing course", kind: "course", category: "courses", priceDollars: 29 }),
  l({ title: "Logo ideas", done: "ai", priceDollars: 29 }),
];

describe("browse", () => {
  it("matches every word of the search in title, seller, kind and detail", () => {
    expect(browse(items, { q: "logo kit" }).map((i) => i.title)).toEqual(["Logo and brand kit"]);
  });
  it("matches the labels visitors read on the cards", () => {
    expect(browse(items, { q: "Automated" }).map((i) => i.title)).toEqual(["Logo ideas"]);
  });
  it("filters by category, type and who does the work", () => {
    expect(browse(items, { type: "course" }).map((i) => i.title)).toEqual(["Glazing course"]);
    expect(browse(items, { done: "ai" }).map((i) => i.title)).toEqual(["Logo ideas"]);
  });
  it("sorts by lowest price, keeping featured order for ties", () => {
    expect(browse(items, { sort: "price" }).map((i) => i.title)).toEqual([
      "Glazing course",
      "Logo ideas",
      "Logo and brand kit",
    ]);
  });
});
