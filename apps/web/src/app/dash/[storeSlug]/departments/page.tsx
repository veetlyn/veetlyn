import { requireSession } from "@/lib/server-api";

import TeamDepartments from "./team-departments";

export default async function DepartmentsPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;
  return <TeamDepartments teamSlug={storeSlug} />;
}
