import { requireSession } from "@/lib/server-api";

import OrdersList from "./orders-list";

export default async function OrdersPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;
  return <OrdersList teamSlug={storeSlug} />;
}
