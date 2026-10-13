import { isServicesTeamSlug, requireSession } from "@/lib/server-api";

import TeamNotFound from "@/components/services-team/team-not-found";

import PayoutRules from "./payout-rules-form";

export default async function PayoutRulesPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  const session = await requireSession();
  const { storeSlug } = await params;
  if (!(await isServicesTeamSlug(storeSlug))) return <TeamNotFound />;
  return <PayoutRules teamSlug={storeSlug} viewerId={session.user.id} />;
}
