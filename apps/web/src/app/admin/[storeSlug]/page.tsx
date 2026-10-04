import { requireSession } from "@/lib/server-api";

import StoreDashboard from "./store-dashboard";

export default async function StoreDashboardPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;

  return <StoreDashboard storeSlug={storeSlug} />;
}
