import { requireSession } from "@/lib/server-api";

import TeamCategories from "./team-categories";

export default async function CategoriesPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;
  return <TeamCategories teamSlug={storeSlug} />;
}
