import { getStoreUrlParts, requireSession } from "@/lib/server-api";

import StoreDashboard from "./store-dashboard";

export default async function StoreDashboardPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;
  const urlParts = await getStoreUrlParts();

  return <StoreDashboard storeSlug={storeSlug} urlParts={urlParts} />;
}
