import { buttonVariants } from "@jendal-workspace/ui/lib/button-variants";
import Link from "next/link";
import { notFound } from "next/navigation";

import { WorkspaceSellers } from "@/components/workspace/workspace-sellers";
import { getStoreUrlParts, listMyWorkspaces, requireSession } from "@/lib/server-api";

// A workspace's home: the sellers in it. Someone outside the workspace gets the same answer as a missing one.
export default async function WorkspaceHome({ params }: { params: Promise<{ organizationId: string }> }) {
  await requireSession();
  const { organizationId } = await params;
  const organization = (await listMyWorkspaces()).find((o) => o.id === organizationId);
  if (!organization) notFound();
  const urlParts = await getStoreUrlParts();

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 md:px-7 md:py-8">
      <div className="space-y-1">
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          Your account
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="font-heading text-3xl">{organization.name}</h1>
          <span className="flex flex-wrap gap-2">
            {organization.canCreateStores ? (
              <>
                <Link href={`/new?workspace=${organization.id}`} className={buttonVariants({ variant: "outline" })}>
                  Add a store
                </Link>
                <Link href={`/new/services-team?workspace=${organization.id}`} className={buttonVariants({ variant: "outline" })}>
                  Add a services team
                </Link>
              </>
            ) : null}
          </span>
        </div>
      </div>
      {organization.stores.length + organization.servicesTeams.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sellers in this workspace yet.</p>
      ) : (
        <WorkspaceSellers organization={organization} urlParts={urlParts} />
      )}
    </main>
  );
}
