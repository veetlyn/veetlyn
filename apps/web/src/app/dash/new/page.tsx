import { getStoreUrlParts, listMyWorkspaces, requireSession } from "@/lib/server-api";

import CreateStoreForm from "./create-store-form";

export default async function NewStorePage({ searchParams }: { searchParams: Promise<{ workspace?: string }> }) {
  await requireSession();
  // Adding to one of the caller's workspaces; without it the seller gets a new workspace (and trial) of its own.
  const { workspace: workspaceId } = await searchParams;
  const workspace = workspaceId ? (await listMyWorkspaces()).find((o) => o.id === workspaceId && o.canCreateStores) : undefined;
  const urlParts = await getStoreUrlParts();

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6 md:px-7 md:py-8">
      <h1 className="font-heading text-3xl">{workspace ? `Add a store to ${workspace.name}` : "Create your store"}</h1>
      <p className="mt-1 text-sm text-muted-foreground">You can rename the store later. Its address cannot be changed.</p>
      <CreateStoreForm urlParts={urlParts} organizationId={workspace?.id} />
    </main>
  );
}
