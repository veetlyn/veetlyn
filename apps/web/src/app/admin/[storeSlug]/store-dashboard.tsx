"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import Loader from "@/components/loader";
import { trpc } from "@/utils/trpc";

export default function StoreDashboard({ storeSlug }: { storeSlug: string }) {
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

  return (
    <main className="container mx-auto max-w-3xl space-y-4 px-4 py-6">
      <Link href="/" className="text-sm text-muted-foreground">
        All stores
      </Link>
      <h1 className="text-2xl font-semibold">{store.data.name}</h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Address</dt>
        <dd>{store.data.slug}</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd>{store.data.status}</dd>
        <dt className="text-muted-foreground">Your role</dt>
        <dd>{store.data.role}</dd>
        <dt className="text-muted-foreground">PayPal</dt>
        <dd>{store.data.paypalMerchantId ?? "Not connected"}</dd>
      </dl>
    </main>
  );
}
