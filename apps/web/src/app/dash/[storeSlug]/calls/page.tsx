import { env } from "cloudflare:workers";

import { platformName } from "@/lib/platform";
import { getStoreUrlParts, requireSession } from "@/lib/server-api";

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
    <SellerCalls
      slug={storeSlug}
      assistantName={platformName()}
      callId={call ?? null}
      projectId={project ?? null}
      urlParts={await getStoreUrlParts()}
      paypalEnvironment={env.PAYPAL_ENVIRONMENT}
    />
  );
}
