import { getPlatformOrigins, requireSession } from "@/lib/server-api";

import CreateServicesTeamForm from "./create-services-team-form";

export default async function NewServicesTeamPage() {
  await requireSession();
  const origins = await getPlatformOrigins();

  return (
    <main className="container mx-auto max-w-lg px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Sell your services</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        A seller is a team of one or a team of many. You can rename it later; its address cannot be changed.
      </p>
      <CreateServicesTeamForm adminOrigin={origins.admin} />
    </main>
  );
}
