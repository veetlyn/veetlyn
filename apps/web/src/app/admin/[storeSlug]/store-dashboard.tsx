"use client";

import { setupSteps } from "@jendal-workspace/core";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import Loader from "@/components/loader";
import PayPalConnectCard from "@/components/paypal-connect-card";
import TeamNotFound from "@/components/services-team/team-not-found";
import SetupChecklist from "@/components/setup-checklist";
import { type StoreUrlParts, storeUrl } from "@/lib/store-url";
import { trpc } from "@/utils/trpc";

export default function StoreDashboard({ storeSlug, urlParts }: { storeSlug: string; urlParts: StoreUrlParts }) {
  const store = useQuery({ ...trpc.store.get.queryOptions({ storeSlug }), retry: false });
  const products = useQuery({ ...trpc.catalog.list.queryOptions({ storeSlug }), retry: false });

  if (store.isPending) return <Loader />;
  if (store.isError) return <TeamNotFound />;

  const url = storeUrl(store.data.slug, urlParts);

  return (
    <main className="container mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <Link href="/" className="text-sm text-muted-foreground">
          All stores
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{store.data.name}</h1>
      </div>
      <SetupChecklist
        steps={setupSteps(
          store.data,
          { productsUrl: `/${storeSlug}/products`, connectPaypal: "#paypal", publish: "#publish" },
          { productCount: products.data?.length ?? 0 },
        )}
      />
      <PayPalConnectCard teamId={store.data.id} />
      <section className="grid gap-2 border p-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-medium">Products</h2>
          <Link href={`/${storeSlug}/products`} className="text-sm underline underline-offset-4">
            {products.data && products.data.length > 0
              ? `Manage ${products.data.length} ${products.data.length === 1 ? "product" : "products"}`
              : "Add a product"}
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          Start from a link or a photo with Channel3, set your prices, and publish when you're ready.
        </p>
      </section>
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
