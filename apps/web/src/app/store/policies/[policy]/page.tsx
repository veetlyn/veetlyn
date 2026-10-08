import { isStorePolicy, policiesFor } from "@jendal-workspace/core";
import { notFound } from "next/navigation";

import LegalPage from "@/components/legal/legal-page";
import { SELLER_POLICY_PAGES } from "@/content/seller-policies";
import { STORE_POLICY_PAGES } from "@/content/store-policies";
import { fetchStorePolicyInfo, getStoreUrlParts } from "@/lib/server-api";
import { storeUrl } from "@/lib/store-url";

export default async function StorePolicyPage({ params }: { params: Promise<{ policy: string }> }) {
  const { policy } = await params;
  if (!isStorePolicy(policy)) notFound();
  const info = await fetchStorePolicyInfo();
  if (!info) notFound();
  if (!policiesFor(info.product).includes(policy)) notFound();

  const page = info.product === "services" ? SELLER_POLICY_PAGES[policy] : STORE_POLICY_PAGES[policy];
  if (!page) notFound();

  const { title, Body } = page;
  const store = { name: info.name, url: storeUrl(info.slug, await getStoreUrlParts()), supportEmail: info.supportEmail };

  return (
    <LegalPage title={title} subtitle={info.name} updatedOn={new Date(info.createdAt)}>
      <Body store={store} />
    </LegalPage>
  );
}
