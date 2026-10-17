import { isServicesTeamSlug, requireSession } from "@/lib/server-api";

import TeamNotFound from "@/components/services-team/team-not-found";

import OfferingForm from "../offering-form";

export default async function EditOfferingPage({
  params,
}: {
  params: Promise<{ storeSlug: string; offeringId: string }>;
}) {
  await requireSession();
  const { storeSlug, offeringId } = await params;
  if (!(await isServicesTeamSlug(storeSlug))) return <TeamNotFound />;
  return <OfferingForm teamSlug={storeSlug} offeringId={offeringId} />;
}
