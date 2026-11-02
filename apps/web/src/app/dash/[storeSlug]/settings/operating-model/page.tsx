import { isServicesTeamSlug, requireSession } from "@/lib/server-api";

import TeamNotFound from "@/components/services-team/team-not-found";

import TeamRules from "./team-rules";

export default async function TeamRulesPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;
  if (!(await isServicesTeamSlug(storeSlug))) return <TeamNotFound />;
  return <TeamRules teamSlug={storeSlug} />;
}
