"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { formatMinor } from "@/lib/money";
import { queryClient, trpc } from "@/utils/trpc";

export default function MarketPricePanel({ storeSlug, productId }: { storeSlug: string; productId: string }) {
  const input = { storeSlug, productId };
  const query = useQuery({ ...trpc.catalog.marketPrice.queryOptions(input), retry: false });
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      const fresh = await queryClient.fetchQuery(trpc.catalog.marketPrice.queryOptions({ ...input, refresh: true }));
      // Write the fresh report into the non-refresh cache entry the panel reads.
      queryClient.setQueryData(trpc.catalog.marketPrice.queryKey(input), fresh);
    } finally {
      setRefreshing(false);
    }
  }

  const report = query.data;
  return (
    <section aria-labelledby="market-price-heading" className="grid gap-2 panel p-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="market-price-heading" className="font-medium">
          Market prices
        </h2>
        <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={refreshing || query.isPending}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      {query.isPending && <p className="text-sm text-muted-foreground">Loading market prices…</p>}
      {query.isError && <p className="text-sm text-muted-foreground">Market prices couldn't be loaded. Try Refresh.</p>}
      {report?.status === "unavailable" && (
        <p className="text-sm text-muted-foreground">Market prices are unavailable right now.</p>
      )}
      {report?.status === "no_offers" && (
        <p className="text-sm text-muted-foreground">No market offers found for this product yet.</p>
      )}
      {report?.status === "ok" && (
        <>
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-muted-foreground">Low</dt>
              <dd>{formatMinor(report.low, report.currency)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Typical</dt>
              <dd>{formatMinor(report.median, report.currency)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">High</dt>
              <dd>{formatMinor(report.high, report.currency)}</dd>
            </div>
          </dl>
          <ul className="text-sm text-muted-foreground">
            {report.examples.map((offer) => (
              <li key={offer.retailer}>
                {offer.retailer}: {formatMinor(offer.priceMinor, report.currency)}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {report.offerCount} offers, checked {new Date(report.fetchedAt).toLocaleString()}.
          </p>
        </>
      )}
    </section>
  );
}
