import { getPlatformOrigins, requireSession } from "@/lib/server-api";

import CreateServicesTeamForm from "./create-services-team-form";

export default async function NewServicesTeamPage() {
  await requireSession();
  const origins = await getPlatformOrigins();

  return (
    <main className="container mx-auto max-w-lg px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Create your services team</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        You can rename the team later. Its address cannot be changed.
      </p>
      <CreateServicesTeamForm adminOrigin={origins.admin} />
    </main>
  );
}
