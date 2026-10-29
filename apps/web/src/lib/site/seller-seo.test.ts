import { describe, expect, it } from "vitest";

import { isIndexableSeller, sellerDescription, sellerJsonLd, sellerRobotsTxt, sellerSitemapXml, type SellerSeoPage } from "./seller-seo";

const page: SellerSeoPage = {
  name: "Design Studio", product: "services", status: "active", bio: "Brand design", currency: "USD",
  offerings: [{ name: "Logo", description: "A custom logo", priceMinMinor: 1255, priceMaxMinor: 10000, daysMin: 2, daysMax: 4 }],
  products: [],
};

describe("seller search output", () => {
  it("excludes drafts, suspended sellers and private transaction paths from crawling", () => {
    expect(isIndexableSeller(page)).toBe(true);
    for (const status of ["draft", "suspended"] as const) {
      expect(isIndexableSeller({ status })).toBe(false);
      expect(sellerRobotsTxt("https://studio.test", false)).toContain("Disallow: /\n");
    }
    const robots = sellerRobotsTxt("https://studio.test", true);
    for (const path of ["/c/", "/pay/", "/orders/", "/buy/"]) expect(robots).toContain(`Disallow: ${path}`);
  });

  it("publishes exact decimal price ranges and seller identity", () => {
    const data = sellerJsonLd(page, "https://studio.test");
    expect(data["@graph"][0]).toMatchObject({
      name: "Design Studio", url: "https://studio.test/",
      makesOffer: [{ priceSpecification: { minPrice: "12.55", maxPrice: "100.00", priceCurrency: "USD" } }],
    });
  });

  it("escapes sitemap URLs and clips long unbroken descriptions without dropping a character", () => {
    expect(sellerSitemapXml("https://studio.test", ["/?a=1&b=2"])).toContain("https://studio.test/?a=1&amp;b=2");
    expect(sellerDescription({ ...page, bio: "x".repeat(200) }, "Platform")).toBe(`${"x".repeat(159)}…`);
  });
});
