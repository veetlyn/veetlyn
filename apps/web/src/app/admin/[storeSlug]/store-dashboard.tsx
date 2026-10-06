"use client";

import { setupSteps } from "@jendal-workspace/core";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import Loader from "@/components/loader";
import SetupChecklist from "@/components/setup-checklist";
import { type StoreUrlParts, storeUrl } from "@/lib/store-url";
import { trpc } from "@/utils/trpc";

export default function StoreDashboard({ storeSlug, urlParts }: { storeSlug: string; urlParts: StoreUrlParts }) {
  const store = useQuery({ ...trpc.store.get.queryOptions({ storeSlug }), retry: false });

  if (store.isPending) return <Loader />;
  if (store.isError) {
    return (
      <main className="container mx-auto max-w-3xl space-y-4 px-4 py-6">
        <h1 className="text-2xl font-semibold">Store not found</h1>
        <Link href="/" className="underline">
          Back to your stores
        </Link>
      </main>
    );
  }

  const url = storeUrl(store.data.slug, urlParts);

  return (
    <main className="container mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <Link href="/" className="text-sm text-muted-foreground">
          All stores
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{store.data.name}</h1>
      </div>
      <SetupChecklist steps={setupSteps(store.data, { storefrontUrl: url })} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Store URL</dt>
        <dd>
          <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            {url}
          </a>
        </dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd>{store.data.status === "draft" ? "Draft · Connect PayPal to start selling." : store.data.status}</dd>
        <dt className="text-muted-foreground">Your role</dt>
        <dd>{store.data.role}</dd>
        <dt className="text-muted-foreground">PayPal</dt>
        <dd>{store.data.paypalMerchantId ?? "Not connected"}</dd>
      </dl>
    </main>
  );
}
