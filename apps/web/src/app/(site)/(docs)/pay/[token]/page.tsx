import { notFound, permanentRedirect } from "next/navigation";

import { fetchLinkTeam, getStoreUrlParts } from "@/lib/server-api";
import { storeUrl } from "@/lib/store-url";

// Pay links sent before the pages moved to the team's site keep working: they redirect there.
export default async function OldPayLink({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const slug = await fetchLinkTeam("pay", token);
  if (!slug) notFound();
  permanentRedirect(`${storeUrl(slug, await getStoreUrlParts())}/pay/${token}`);
}
