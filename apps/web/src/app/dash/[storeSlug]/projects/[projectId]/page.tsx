import { requireSession } from "@/lib/server-api";

import ProjectDetail from "./project-detail";

export default async function ProjectPage({ params }: { params: Promise<{ storeSlug: string; projectId: string }> }) {
  await requireSession();
  const { storeSlug, projectId } = await params;
  return <ProjectDetail teamSlug={storeSlug} projectId={projectId} />;
}
