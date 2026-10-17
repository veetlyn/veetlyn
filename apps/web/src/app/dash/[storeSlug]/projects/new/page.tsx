import { requireSession } from "@/lib/server-api";

import NewProjectForm from "./new-project-form";

export default async function NewProjectPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;
  return <NewProjectForm teamSlug={storeSlug} />;
}
