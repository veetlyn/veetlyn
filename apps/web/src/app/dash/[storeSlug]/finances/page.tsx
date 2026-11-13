import { requireSession } from "@/lib/server-api";

import TeamFinances from "./team-finances";

export default async function FinancesPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;
  return <TeamFinances teamSlug={storeSlug} />;
}
