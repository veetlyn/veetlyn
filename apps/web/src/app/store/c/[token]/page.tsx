import { notFound } from "next/navigation";

import { fetchLinkTeam, fetchStoreInfo } from "@/lib/server-api";

import ClientProject from "./client-project";

// The client page lives on the team's own site; the same token on another team's site is not found.
export default async function ClientProjectPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [store, linkTeam] = await Promise.all([fetchStoreInfo(), fetchLinkTeam("client", token)]);
  if (!store || store.slug !== linkTeam) notFound();
  return <ClientProject token={token} />;
}
