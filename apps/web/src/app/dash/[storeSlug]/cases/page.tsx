import { env } from "cloudflare:workers";

import { isServicesTeamSlug, requireSession } from "@/lib/server-api";

import TeamNotFound from "@/components/services-team/team-not-found";

import TeamCases from "./team-cases";

export default async function TeamCasesPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;
  if (!(await isServicesTeamSlug(storeSlug))) return <TeamNotFound />;
  return <TeamCases teamSlug={storeSlug} paypalEnvironment={env.PAYPAL_ENVIRONMENT} />;
}
