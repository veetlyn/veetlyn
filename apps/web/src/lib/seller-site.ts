import type { Metadata } from "next";

import { isIndexedStage, platformName } from "./platform";
import { fetchSellerPage, getStoreUrlParts, type SellerPageView } from "./server-api";
import { isIndexableSeller, sellerDescription } from "./site/seller-seo";
import { storeUrl } from "./store-url";

export const NOINDEX: Metadata = { robots: { index: false, follow: false } };

export type SellerSite = { page: SellerPageView; url: string; indexable: boolean };

// The seller's public origin on the store domain, and whether search engines may list it.
export async function sellerSite(): Promise<SellerSite | null> {
  const page = await fetchSellerPage();
  if (!page) return null;
  const url = storeUrl(page.slug, await getStoreUrlParts());
  return { page, url, indexable: isIndexedStage() && isIndexableSeller(page) };
}

export async function sellerMetadata(p: { path: string; title?: string; description?: string; index?: boolean }): Promise<Metadata> {
  const site = await sellerSite();
  if (!site) return NOINDEX;
  const { page, url, indexable } = site;
  const title = p.title ? `${p.title} · ${page.name}` : page.name;
  const description = p.description ?? sellerDescription(page, platformName());
  const canonical = `${url}${p.path}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: page.name, type: "website" },
    twitter: { card: "summary", title, description },
    robots: indexable && p.index !== false ? undefined : { index: false, follow: p.index !== false && indexable },
  };
}
