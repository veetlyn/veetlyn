import { notFound } from "next/navigation";

import SandboxCheckoutHelp from "@/components/sandbox-checkout-help";
import { NOINDEX } from "@/lib/seller-site";
import { fetchLinkTeam, fetchStoreInfo } from "@/lib/server-api";

import PayPage from "./pay-page";

// A tokenised link is private to its client.
export const metadata = NOINDEX;

// The pay page lives on the team's own site, next to its client page.
export default async function PayRoute({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [store, linkTeam] = await Promise.all([fetchStoreInfo(), fetchLinkTeam("pay", token)]);
  if (!store || store.slug !== linkTeam) notFound();
  return (
    <>
      <PayPage token={token} />
      <div className="px-4 pb-10">
        <SandboxCheckoutHelp />
      </div>
    </>
  );
}
