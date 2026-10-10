import { notFound } from "next/navigation";

import SellerPage from "@/components/seller-page/seller-page";
import StoreHome from "@/components/seller-page/store-home";
import { fetchSellerPage, fetchStoreInfo } from "@/lib/server-api";

export default async function StorefrontHome() {
  const store = await fetchStoreInfo();
  if (!store) notFound();
  const page = await fetchSellerPage();
  if (store.product === "services") {
    if (!page) notFound();
    return <SellerPage page={{ ...page, pageBase: "" }} />;
  }
  // A Commerce team keeps its plain home when the seller page is unavailable or has no digital products.
  if (page && page.products.length > 0) return <SellerPage page={{ ...page, pageBase: "" }} />;
  return <StoreHome name={store.name} />;
}
