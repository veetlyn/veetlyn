import { requireSession } from "@/lib/server-api";
import { platformName } from "@/lib/platform";

import SellerCalls from "./seller-calls";

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
  return (
    <SellerCalls slug={storeSlug} assistantName={platformName()} callId={call ?? null} projectId={project ?? null} />
  );
}
