import { isServicesTeamSlug, requireSession } from "@/lib/server-api";

import TeamNotFound from "@/components/services-team/team-not-found";

import ServicesTeamSettings from "./services-team-settings";

// Only services teams have settings; a store slug here is a wrong turn.
export default async function ServicesTeamSettingsPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;
  if (!(await isServicesTeamSlug(storeSlug))) return <TeamNotFound />;
  return <ServicesTeamSettings teamSlug={storeSlug} />;
}
