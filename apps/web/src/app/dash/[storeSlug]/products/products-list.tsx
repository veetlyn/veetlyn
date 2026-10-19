"use client";

import { Badge } from "@jendal-workspace/ui/components/badge";
import { buttonVariants } from "@jendal-workspace/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Package } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import DigitalProducts from "@/components/catalog/digital-products";
import Loader from "@/components/loader";
import TeamNotFound from "@/components/services-team/team-not-found";
import { productImageUrl } from "@/lib/image-url";
import { formatMinor } from "@/lib/money";
import { trpc } from "@/utils/trpc";

export default function ProductsList({ storeSlug }: { storeSlug: string }) {
  const store = useQuery({ ...trpc.store.get.queryOptions({ storeSlug }), retry: false, meta: { silent: true } });

  if (store.isPending) return <Loader />;
  if (store.isError) return <TeamNotFound />;
  if (store.data.product === "services") return <DigitalProducts teamSlug={storeSlug} />;
  return <CommerceProductsList storeSlug={storeSlug} />;
}

function CommerceProductsList({ storeSlug }: { storeSlug: string }) {
  const products = useQuery({ ...trpc.catalog.list.queryOptions({ storeSlug }), retry: false, meta: { silent: true } });

  if (products.isPending) return <Loader />;

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 md:px-7 md:py-8">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-heading text-3xl">Products</h1>
        </div>
        <Link href={`/${storeSlug}/products/new`} className={buttonVariants()}>
          Add product
        </Link>
      </div>

      {products.isError && <p role="alert">The products couldn't be loaded.</p>}

      {products.data?.length === 0 && (
        <section className="panel grid justify-items-center gap-2 p-10 text-center">
          <p className="font-heading text-lg">No products yet</p>
          <p className="text-sm text-muted-foreground">
            Add your first product — start from a link, a photo, or a blank form.
          </p>
        </section>
      )}

      {products.data && products.data.length > 0 && (
        <ul className="panel divide-y overflow-hidden">
          {products.data.map((product) => (
            <li key={product.id}>
              <Link href={`/${storeSlug}/products/${product.id}`} className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-accent/60">
                <ProductThumb imageKey={product.imageKey} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-medium">
                    <span className="truncate">{product.title}</span>
                    <Badge tone={product.status === "published" ? "good" : "neutral"}>
                      {product.status === "published" ? "Published" : "Draft"}
                    </Badge>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {product.variantCount}{" "}
                    {product.variantCount === 1 ? "variant" : "variants"} · {product.totalStock} in stock
                  </p>
                </div>
                <p className="font-tabular text-sm">
                  {product.priceLow === null
                    ? "No price"
                    : product.priceLow === product.priceHigh
                      ? formatMinor(product.priceLow, "USD")
                      : `${formatMinor(product.priceLow, "USD")}–${formatMinor(product.priceHigh!, "USD")}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

// A product without a usable image shows a package icon instead of an empty or broken frame.
function ProductThumb({ imageKey }: { imageKey: string | null }) {
  const [broken, setBroken] = useState(false);
  if (imageKey && !broken) {
    return <img src={productImageUrl(imageKey)} alt="" onError={() => setBroken(true)} className="size-12 rounded-md border object-cover" />;
  }
  return (
    <div aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground well">
      <Package className="size-5" />
    </div>
  );
}
