"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import CreateOrganizationForm from "@/components/create-organization-form";
import CreateStoreForm from "@/components/create-store-form";
import Loader from "@/components/loader";
import type { StoreUrlParts } from "@/lib/store-url";
import { trpc } from "@/utils/trpc";

export default function StoresOverview({ urlParts }: { urlParts: StoreUrlParts }) {
  const organizations = useQuery(trpc.store.listMine.queryOptions());

  if (organizations.isPending) return <Loader />;
  if (organizations.isError) return <p className="text-destructive">Could not load your stores.</p>;

  const refresh = () => void organizations.refetch();

  if (organizations.data.length === 0) return <CreateOrganizationForm onCreated={refresh} />;

  return (
    <div className="space-y-8">
      {organizations.data.map((organization) => (
        <section key={organization.id} className="space-y-3">
          <h2 className="text-lg font-medium">{organization.name}</h2>
          {organization.stores.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stores yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {organization.stores.map((store) => (
                <li key={store.id}>
                  <Link href={`/${store.slug}`} className="flex items-center justify-between px-4 py-3 hover:bg-muted">
                    <span>{store.name}</span>
                    <span className="text-sm text-muted-foreground">{store.status}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {organization.canCreateStores ? (
            <CreateStoreForm organizationId={organization.id} urlParts={urlParts} onCreated={refresh} />
          ) : null}
        </section>
      ))}
    </div>
  );
}
