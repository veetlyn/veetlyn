import { isServicesTeamSlug, requireSession } from "@/lib/server-api";

import TeamNotFound from "@/components/services-team/team-not-found";

import DiscordLink from "./discord-link";

// Only services teams can link a server; a store slug here is a wrong turn.
export default async function TeamDiscordPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;
  if (!(await isServicesTeamSlug(storeSlug))) return <TeamNotFound />;
  return <DiscordLink teamSlug={storeSlug} />;
}
