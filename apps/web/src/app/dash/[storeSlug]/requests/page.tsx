import { requireSession } from "@/lib/server-api";

import OpenRequests from "./open-requests";

export default async function RequestsPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;
  return <OpenRequests teamSlug={storeSlug} />;
}
