import { isServicesTeamSlug, requireSession } from "@/lib/server-api";
import { platformName } from "@/lib/platform";

import TeamNotFound from "@/components/services-team/team-not-found";

import TeamCalls from "./team-calls";

export default async function TeamCallsPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeSlug: string }>;
  searchParams: Promise<{ call?: string; project?: string }>;
}) {
  await requireSession();
  const { storeSlug } = await params;
  const { call, project } = await searchParams;
  if (!(await isServicesTeamSlug(storeSlug))) return <TeamNotFound />;
  return <TeamCalls teamSlug={storeSlug} assistantName={platformName()} callId={call ?? null} projectId={project ?? null} />;
}
