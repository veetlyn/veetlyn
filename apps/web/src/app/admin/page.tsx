import { getStoreUrlParts, requireSession } from "@/lib/server-api";

import StoresOverview from "./stores-overview";

export default async function AdminHome() {
  const session = await requireSession();
  const urlParts = await getStoreUrlParts();

  return (
    <main className="container mx-auto max-w-3xl space-y-6 px-4 py-6">
      <h1 className="text-2xl font-semibold">Welcome, {session.user.name}</h1>
      <StoresOverview urlParts={urlParts} />
    </main>
  );
}
