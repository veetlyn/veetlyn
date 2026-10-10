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
  // Fall back to the plain home rather than 404 when the seller page is unavailable.
  if (page && page.products.length > 0) return <SellerPage page={{ ...page, pageBase: "" }} />;
  return <StoreHome name={store.name} />;
}
