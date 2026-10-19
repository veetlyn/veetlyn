"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import DigitalProductForm from "@/components/catalog/digital-product-form";
import ProductForm from "@/components/catalog/product-form";
import Loader from "@/components/loader";
import TeamNotFound from "@/components/services-team/team-not-found";
import { trpc } from "@/utils/trpc";

export default function NewProduct({ storeSlug }: { storeSlug: string }) {
  const store = useQuery({ ...trpc.store.get.queryOptions({ storeSlug }), retry: false, meta: { silent: true } });

  if (store.isPending) return <Loader />;
  if (store.isError) return <TeamNotFound />;

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 md:px-7 md:py-8">
      <div className="space-y-1">
        <Link href={`/${storeSlug}/products`} className="text-sm text-muted-foreground hover:text-foreground">
          Products
        </Link>
        <h1 className="font-heading text-3xl">Add a product</h1>
      </div>
      {store.data.product === "services" ? <DigitalProductForm teamSlug={storeSlug} /> : <ProductForm storeSlug={storeSlug} />}
    </main>
  );
}
