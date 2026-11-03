import Link from "next/link";

import { getPlatformOrigins, listMyWorkspaces, requireSession } from "@/lib/server-api";

import CreateServicesTeamForm from "./create-services-team-form";

export default async function NewServicesTeamPage({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  await requireSession();
  // Adding to one of the caller's workspaces; without it the seller gets a new workspace (and trial) of its own.
  const { workspace: workspaceId } = await searchParams;
  const workspace = workspaceId ? (await listMyWorkspaces()).find((o) => o.id === workspaceId && o.canCreateStores) : undefined;
  const origins = await getPlatformOrigins();

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6 md:px-7 md:py-8">
      <h1 className="font-heading text-3xl">{workspace ? `Add a services team to ${workspace.name}` : "Sell your services"}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        A seller is a team of one or a team of many. You can rename it later; its address cannot be changed.
      </p>
      <CreateServicesTeamForm dashOrigin={origins.dash} organizationId={workspace?.id} />
      <p className="mt-6 text-sm text-muted-foreground">
        Selling digital products?{" "}
        <Link href="/new" className="underline underline-offset-4">
          Create a store
        </Link>
        .
      </p>
    </main>
  );
}
