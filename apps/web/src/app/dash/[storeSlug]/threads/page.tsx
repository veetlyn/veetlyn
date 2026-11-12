import { platformName } from "@/lib/platform";
import { requireSession } from "@/lib/server-api";

import SellerCalls from "./seller-calls";

export default async function TeamCallsPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeSlug: string }>;
  searchParams: Promise<{ thread?: string; call?: string; project?: string }>;
}) {
  await requireSession();
  const { storeSlug } = await params;
  const { thread, call, project } = await searchParams;
  return (
    <SellerCalls slug={storeSlug} assistantName={platformName()} callId={thread ?? call ?? null} projectId={project ?? null} />
  );
}
