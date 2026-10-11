import { notFound } from "next/navigation";

import SellerPage from "@/components/seller-page/seller-page";
import StoreHome from "@/components/seller-page/store-home";
import { fetchSellerPage, fetchStoreInfo } from "@/lib/server-api";

export default async function StorefrontHome() {
  const store = await fetchStoreInfo();
  if (!store) notFound();
  // Commerce teams never list products on the home page, so only services fetch the seller page.
  if (store.product !== "services") return <StoreHome name={store.name} />;
  const page = await fetchSellerPage();
  if (!page) notFound();
  return <SellerPage page={{ ...page, pageBase: "" }} />;
}
