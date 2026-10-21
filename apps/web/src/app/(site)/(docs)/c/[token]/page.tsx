import { notFound, permanentRedirect } from "next/navigation";

import { fetchLinkTeam, getStoreUrlParts } from "@/lib/server-api";
import { storeUrl } from "@/lib/store-url";

// Client links emailed before the pages moved to the team's site keep working: they redirect there.
export default async function OldClientLink({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const slug = await fetchLinkTeam("client", token);
  if (!slug) notFound();
  permanentRedirect(`${storeUrl(slug, await getStoreUrlParts())}/c/${token}`);
}
