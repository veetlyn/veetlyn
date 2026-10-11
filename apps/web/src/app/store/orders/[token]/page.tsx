import { notFound } from "next/navigation";

import { fetchStoreInfo } from "@/lib/server-api";

import OrderPage from "./order-page";

// The token in the link is the buyer's only credential, checked by order.get against this store's slug.
export default async function StoreOrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const store = await fetchStoreInfo();
  if (!store) notFound();
  return <OrderPage token={token} slug={store.slug} />;
}
