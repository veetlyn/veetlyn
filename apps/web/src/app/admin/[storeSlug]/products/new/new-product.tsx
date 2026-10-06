"use client";

import Link from "next/link";

import ProductForm from "@/components/catalog/product-form";

export default function NewProduct({ storeSlug }: { storeSlug: string }) {
  return (
    <main className="container mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <Link href={`/${storeSlug}/products`} className="text-sm text-muted-foreground">
          Products
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Add a product</h1>
      </div>
      <ProductForm storeSlug={storeSlug} />
    </main>
  );
}
