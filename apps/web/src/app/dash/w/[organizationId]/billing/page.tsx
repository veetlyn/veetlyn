import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import Loader from "@/components/loader";
import { listMyWorkspaces, requireSession } from "@/lib/server-api";

import BillingPanel from "./billing-panel";

// Billing design §7: the workspace's plan, for its owners and admins. Anyone else gets the same answer as a missing one.
export default async function WorkspaceBillingPage({ params }: { params: Promise<{ organizationId: string }> }) {
  await requireSession();
  const { organizationId } = await params;
  const organization = (await listMyWorkspaces()).find((o) => o.id === organizationId && o.canCreateStores);
  if (!organization) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 md:px-7 md:py-8">
      <div className="space-y-1">
        <Link href={`/w/${organizationId}`} className="text-sm text-muted-foreground hover:text-foreground">
          {organization.name}
        </Link>
        <h1 className="font-heading text-3xl">Billing</h1>
      </div>
      <Suspense fallback={<Loader />}>
        <BillingPanel organizationId={organizationId} />
      </Suspense>
    </main>
  );
}
