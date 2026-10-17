import { isServicesTeamSlug, requireSession } from "@/lib/server-api";

import TeamNotFound from "@/components/services-team/team-not-found";

import TeamPayouts from "./team-payouts";

export default async function TeamPayoutsPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  const session = await requireSession();
  const { storeSlug } = await params;
  if (!(await isServicesTeamSlug(storeSlug))) return <TeamNotFound />;
  return <TeamPayouts teamSlug={storeSlug} viewerId={session.user.id} />;
}
