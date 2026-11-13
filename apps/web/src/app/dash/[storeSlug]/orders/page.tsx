import { requireSession } from "@/lib/server-api";

import TeamOrders from "./team-orders";

export default async function OrdersPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;
  return <TeamOrders teamSlug={storeSlug} />;
}
