import { requireSession } from "@/lib/server-api";

import ProjectsList from "./projects-list";

export default async function ProjectsPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;
  return <ProjectsList teamSlug={storeSlug} />;
}
