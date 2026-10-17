"use client";

import { buttonVariants } from "@jendal-workspace/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

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
    <main className="container mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div className="flex items-baseline justify-between gap-4">
        <div className="space-y-1">
          <Link href={`/${storeSlug}`} className="text-sm text-muted-foreground">
            {storeSlug}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
        </div>
        <Link href={`/${storeSlug}/products/new`} className={buttonVariants()}>
          Add product
        </Link>
      </div>

      {products.isError && <p role="alert">The products couldn't be loaded.</p>}

      {products.data?.length === 0 && (
        <section className="grid gap-2 border border-dashed p-8 text-center">
          <p className="font-medium">No products yet</p>
          <p className="text-sm text-muted-foreground">
            Add your first product — start from a link, a photo, or a blank form.
          </p>
        </section>
      )}

      {products.data && products.data.length > 0 && (
        <ul className="divide-y border">
          {products.data.map((product) => (
            <li key={product.id}>
              <Link href={`/${storeSlug}/products/${product.id}`} className="flex items-center gap-4 p-3">
                {product.imageKey ? (
                  <img src={productImageUrl(product.imageKey)} alt="" className="size-12 border object-cover" />
                ) : (
                  <div aria-hidden className="size-12 border bg-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{product.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {product.status === "published" ? "Published" : "Draft"} · {product.variantCount}{" "}
                    {product.variantCount === 1 ? "variant" : "variants"} · {product.totalStock} in stock
                  </p>
                </div>
                <p className="text-sm">
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
