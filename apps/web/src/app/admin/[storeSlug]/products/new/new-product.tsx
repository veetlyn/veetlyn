"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import DigitalProductForm from "@/components/catalog/digital-product-form";
import ProductForm from "@/components/catalog/product-form";
import Loader from "@/components/loader";
import TeamNotFound from "@/components/services-team/team-not-found";
import { trpc } from "@/utils/trpc";

export default function NewProduct({ storeSlug }: { storeSlug: string }) {
  const store = useQuery({ ...trpc.store.get.queryOptions({ storeSlug }), retry: false });

  if (store.isPending) return <Loader />;
  if (store.isError) return <TeamNotFound />;

  return (
    <main className="container mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <Link href={`/${storeSlug}/products`} className="text-sm text-muted-foreground">
          Products
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Add a product</h1>
      </div>
      {store.data.product === "services" ? <DigitalProductForm teamSlug={storeSlug} /> : <ProductForm storeSlug={storeSlug} />}
    </main>
  );
}
