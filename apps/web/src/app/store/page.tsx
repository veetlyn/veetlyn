import { notFound } from "next/navigation";

import SellerPage from "@/components/seller-page/seller-page";
import StoreHome from "@/components/seller-page/store-home";
import { fetchSellerPage, fetchStoreInfo } from "@/lib/server-api";

export default async function StorefrontHome() {
  const store = await fetchStoreInfo();
  if (!store) notFound();
  if (store.product === "services") {
    const page = await fetchSellerPage();
    if (!page) notFound();
    return <SellerPage page={{ ...page, requestBase: "" }} />;
  }
  return <StoreHome name={store.name} />;
}
