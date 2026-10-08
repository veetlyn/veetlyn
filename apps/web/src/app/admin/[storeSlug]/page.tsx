import { getStoreUrlParts, isServicesTeamSlug, requireSession } from "@/lib/server-api";

import ServicesTeamDashboard from "./services-team-dashboard";
import StoreDashboard from "./store-dashboard";

// Store and services team slugs share one namespace (services spec §9); the product picks the dashboard.
export default async function TeamDashboardPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;

  const urlParts = await getStoreUrlParts();
  if (await isServicesTeamSlug(storeSlug)) {
    return <ServicesTeamDashboard teamSlug={storeSlug} urlParts={urlParts} />;
  }

  return <StoreDashboard storeSlug={storeSlug} urlParts={urlParts} />;
}
