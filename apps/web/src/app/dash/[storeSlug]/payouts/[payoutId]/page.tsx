import { isServicesTeamSlug, requireSession } from "@/lib/server-api";

import TeamNotFound from "@/components/services-team/team-not-found";

import PayoutRecord from "./payout-record";

export default async function PayoutRecordPage({ params }: { params: Promise<{ storeSlug: string; payoutId: string }> }) {
  const session = await requireSession();
  const { storeSlug, payoutId } = await params;
  if (!(await isServicesTeamSlug(storeSlug))) return <TeamNotFound />;
  return <PayoutRecord teamSlug={storeSlug} payoutId={payoutId} viewerId={session.user.id} />;
}
