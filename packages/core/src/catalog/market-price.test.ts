import { describe, expect, it } from "vitest";

import {
  MARKET_PRICE_REFRESH_TTL_SECONDS,
  MARKET_PRICE_TTL_SECONDS,
  collectPricedOffers,
  marketPriceCacheKey,
  marketPriceRefreshKey,
  summarizeMarketPrices,
  toMinorUnits,
} from "./market-price";
import type { SourceProduct } from "./source";

const at = new Date("2026-10-06T12:00:00Z");

function productWithOffers(offers: SourceProduct["offers"]): SourceProduct {
  return {
    id: "c3-1",
    title: "Lamp",
    description: null,
    brands: [],
    images: [],
    category: null,
    variantOptions: [],
    offers,
  };
}

describe("toMinorUnits", () => {
  it("converts major units to minor units", () => {
    expect(toMinorUnits(12)).toBe(1200);
    expect(toMinorUnits(12.5)).toBe(1250);
    expect(toMinorUnits(0.1 + 0.2)).toBe(30);
  });
});

describe("collectPricedOffers", () => {
  it("keeps in-stock offers in the requested currency, mapped to minor units", () => {
    const offers = collectPricedOffers(
      [
        productWithOffers([
          { retailer: "shop-a.com", price: 10, currency: "USD", inStock: true },
          { retailer: "shop-b.com", price: 9.99, currency: "EUR", inStock: true },
          { retailer: "shop-c.com", price: 8, currency: "USD", inStock: false },
        ]),
        productWithOffers([{ retailer: "shop-d.com", price: 11.5, currency: "USD", inStock: true }]),
      ],
      "USD",
    );

    expect(offers).toEqual([
      { retailer: "shop-a.com", priceMinor: 1000 },
      { retailer: "shop-d.com", priceMinor: 1150 },
    ]);
  });
});

describe("summarizeMarketPrices", () => {
  it("answers no_offers for an empty set", () => {
    expect(summarizeMarketPrices([], "USD", at)).toEqual({
      status: "no_offers",
      currency: "USD",
      fetchedAt: "2026-10-06T12:00:00.000Z",
    });
  });

  it("computes low, median and high for an odd count", () => {
    const report = summarizeMarketPrices(
      [
        { retailer: "b.com", priceMinor: 300 },
        { retailer: "a.com", priceMinor: 100 },
        { retailer: "c.com", priceMinor: 200 },
      ],
      "USD",
      at,
    );

    expect(report).toEqual({
      status: "ok",
      currency: "USD",
      offerCount: 3,
      low: 100,
      median: 200,
      high: 300,
      examples: [
        { retailer: "a.com", priceMinor: 100 },
        { retailer: "c.com", priceMinor: 200 },
        { retailer: "b.com", priceMinor: 300 },
      ],
      fetchedAt: "2026-10-06T12:00:00.000Z",
    });
  });

  it("rounds the median half up for an even count and shows at most three examples", () => {
    const report = summarizeMarketPrices(
      [100, 201, 400, 800].map((priceMinor, i) => ({ retailer: `shop-${i}.com`, priceMinor })),
      "USD",
      at,
    );

    expect(report).toMatchObject({ status: "ok", low: 100, median: 301, high: 800, offerCount: 4 });
    expect(report.status === "ok" && report.examples).toHaveLength(3);
  });

  it("ignores offers without a positive price", () => {
    expect(
      summarizeMarketPrices([{ retailer: "a.com", priceMinor: 0 }], "USD", at).status,
    ).toBe("no_offers");
  });
});

describe("cache keys", () => {
  it("builds the report and refresh keys with the documented TTLs", () => {
    expect(marketPriceCacheKey("store-1", "prod-1")).toBe("market-price:store-1:prod-1");
    expect(marketPriceRefreshKey("store-1", "prod-1")).toBe("market-price:store-1:prod-1:refreshed");
    expect(MARKET_PRICE_TTL_SECONDS).toBe(86_400);
    expect(MARKET_PRICE_REFRESH_TTL_SECONDS).toBe(3_600);
  });
});
