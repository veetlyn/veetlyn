import { env } from "cloudflare:workers";
import { notFound, redirect } from "next/navigation";

import { requireSession } from "@/lib/server-api";
import { PROJECT_TABS } from "@/lib/project-tabs";
import ProjectDetail from "../project-detail";

export default async function ProjectViewPage({ params }: { params: Promise<{ storeSlug: string; projectId: string; view: string }> }) {
  await requireSession();
  const { storeSlug, projectId, view } = await params;
  if (view === "overview") redirect(`/${storeSlug}/projects/${projectId}`);
  const tab = PROJECT_TABS.find((candidate) => candidate.key === view);
  if (!tab) notFound();
  return <ProjectDetail teamSlug={storeSlug} projectId={projectId} view={tab.key} paypalEnvironment={env.PAYPAL_ENVIRONMENT} />;
}
