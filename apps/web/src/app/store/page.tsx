import { notFound } from "next/navigation";

import SellerPage from "@/components/seller-page/seller-page";
import StoreHome from "@/components/seller-page/store-home";
import JsonLd from "@/components/site/json-ld";
import { sellerMetadata, sellerSite } from "@/lib/seller-site";
import { fetchStoreInfo } from "@/lib/server-api";
import { sellerJsonLd } from "@/lib/site/seller-seo";

export async function generateMetadata() {
  const store = await fetchStoreInfo();
  // A commerce team's home is a placeholder until its products are listed, so it stays out of the index.
  return sellerMetadata({ path: "/", index: store?.product === "services" });
}

export default async function StorefrontHome() {
  const store = await fetchStoreInfo();
  if (!store) notFound();
  // Commerce teams never list products on the home page, so only services fetch the seller page.
  if (store.product !== "services") return <StoreHome name={store.name} />;
  const site = await sellerSite();
  if (!site) notFound();
  return (
    <>
      {site.indexable ? <JsonLd data={sellerJsonLd(site.page, site.url)} /> : null}
      <SellerPage page={{ ...site.page, pageBase: "" }} />
    </>
  );
}
