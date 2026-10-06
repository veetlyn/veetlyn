import type { SourceProduct } from "./source";

export type PricedOffer = { retailer: string; priceMinor: number };

export type MarketPriceReport =
  | {
      status: "ok";
      currency: string;
      offerCount: number;
      low: number;
      median: number;
      high: number;
      examples: PricedOffer[];
      fetchedAt: string;
    }
  | { status: "no_offers"; currency: string; fetchedAt: string };

// "unavailable" is added by the caller when the source cannot be reached or is not configured.
export type MarketPriceResult = MarketPriceReport | { status: "unavailable" };

// Sponsor spec §3.2: results are cached for 24 hours; "Refresh" bypasses the cache at most once an hour.
export const MARKET_PRICE_TTL_SECONDS = 86_400;
export const MARKET_PRICE_REFRESH_TTL_SECONDS = 3_600;

export function marketPriceCacheKey(storeId: string, productId: string): string {
  return `market-price:${storeId}:${productId}`;
}

export function marketPriceRefreshKey(storeId: string, productId: string): string {
  return `${marketPriceCacheKey(storeId, productId)}:refreshed`;
}

export function toMinorUnits(price: number): number {
  return Math.round(price * 100);
}

export function collectPricedOffers(products: readonly SourceProduct[], currency: string): PricedOffer[] {
  return products.flatMap((product) =>
    product.offers
      .filter((offer) => offer.inStock && offer.currency === currency)
      .map((offer) => ({ retailer: offer.retailer, priceMinor: toMinorUnits(offer.price) })),
  );
}

export function summarizeMarketPrices(
  offers: readonly PricedOffer[],
  currency: string,
  fetchedAt: Date,
): MarketPriceReport {
  const priced = offers.filter((offer) => offer.priceMinor > 0).sort((a, b) => a.priceMinor - b.priceMinor);
  const iso = fetchedAt.toISOString();
  if (priced.length === 0) return { status: "no_offers", currency, fetchedAt: iso };
  const prices = priced.map((offer) => offer.priceMinor);
  const middle = Math.floor(prices.length / 2);
  const median =
    prices.length % 2 === 1 ? prices[middle]! : Math.round((prices[middle - 1]! + prices[middle]!) / 2);
  return {
    status: "ok",
    currency,
    offerCount: priced.length,
    low: prices[0]!,
    median,
    high: prices[prices.length - 1]!,
    examples: priced.slice(0, 3),
    fetchedAt: iso,
  };
}
