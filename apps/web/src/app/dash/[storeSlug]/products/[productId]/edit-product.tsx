"use client";

import { Badge } from "@jendal-workspace/ui/components/badge";
import { Button } from "@jendal-workspace/ui/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";

import DigitalProductForm from "@/components/catalog/digital-product-form";
import Loader from "@/components/loader";
import MarketPricePanel from "@/components/catalog/market-price-panel";
import ProductForm from "@/components/catalog/product-form";
import TeamNotFound from "@/components/services-team/team-not-found";
import { productImageUrl } from "@/lib/image-url";
import { minorToPriceInput } from "@/lib/money";
import type { ProductFormState } from "@/lib/product-form-state";
import { queryClient, trpc } from "@/utils/trpc";

export default function EditProduct({ storeSlug, productId }: { storeSlug: string; productId: string }) {
  const store = useQuery({ ...trpc.store.get.queryOptions({ storeSlug }), retry: false, meta: { silent: true } });

  if (store.isPending) return <Loader />;
  if (store.isError) return <TeamNotFound />;
  if (store.data.product === "services") {
    return (
      <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 md:px-7 md:py-8">
        <DigitalProductForm teamSlug={storeSlug} productId={productId} />
      </main>
    );
  }
  return <EditCommerceProduct storeSlug={storeSlug} productId={productId} />;
}

function EditCommerceProduct({ storeSlug, productId }: { storeSlug: string; productId: string }) {
  const detail = useQuery({ ...trpc.catalog.get.queryOptions({ storeSlug, id: productId }), retry: false, meta: { silent: true } });
  const publish = useMutation(trpc.catalog.publish.mutationOptions());
  const unpublish = useMutation(trpc.catalog.unpublish.mutationOptions());

  if (detail.isPending) return <Loader />;
  if (detail.isError) {
    return (
      <main className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 md:px-7 md:py-8">
        <h1 className="font-[family-name:var(--font-display)] text-3xl">Product not found</h1>
        <Link href={`/${storeSlug}/products`} className="text-sm underline underline-offset-4">
          Back to products
        </Link>
      </main>
    );
  }

  const { product, variants, images } = detail.data;
  const initial: ProductFormState = {
    title: product.title,
    description: product.description,
    brand: product.brand,
    category: product.category,
    chargeTax: product.chargeTax,
    requiresShipping: product.requiresShipping,
    channel3ProductId: product.channel3ProductId,
    variants: variants.map((variant) => ({
      options: variant.options,
      sku: variant.sku ?? "",
      price: minorToPriceInput(variant.priceMinor),
      stock: String(variant.stock),
    })),
    images: images.map((image) => ({
      imageKey: image.imageKey,
      alt: image.alt,
      previewUrl: productImageUrl(image.imageKey),
    })),
    // Editing a product that was already imported does not ask again.
    rightsConfirmed: product.channel3ProductId !== null,
  };

  const statusMutation = product.status === "published" ? unpublish : publish;

  async function toggleStatus() {
    await statusMutation.mutateAsync({ storeSlug, id: productId });
    await Promise.all([
      detail.refetch(),
      queryClient.invalidateQueries({ queryKey: trpc.catalog.list.queryKey({ storeSlug }) }),
    ]);
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 md:px-7 md:py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <Link href={`/${storeSlug}/products`} className="text-sm text-muted-foreground hover:text-foreground">
            Products
          </Link>
          <h1 className="font-[family-name:var(--font-display)] text-3xl">{product.title}</h1>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={product.status === "published" ? "good" : "neutral"}>
            {product.status === "published" ? "Published" : "Draft"}
          </Badge>
          <Button type="button" variant="outline" onClick={toggleStatus} disabled={statusMutation.isPending}>
            {product.status === "published" ? "Unpublish" : "Publish"}
          </Button>
        </div>
      </div>
      {statusMutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {statusMutation.error.message}
        </p>
      )}
      <MarketPricePanel storeSlug={storeSlug} productId={productId} />
      <ProductForm storeSlug={storeSlug} productId={productId} initial={initial} />
    </main>
  );
}
