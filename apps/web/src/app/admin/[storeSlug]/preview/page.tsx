import { getStoreUrlParts, requireSession } from "@/lib/server-api";

import SellerPreview from "./seller-preview";

export default async function SellerPreviewPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;
  return <SellerPreview teamSlug={storeSlug} urlParts={await getStoreUrlParts()} />;
}
