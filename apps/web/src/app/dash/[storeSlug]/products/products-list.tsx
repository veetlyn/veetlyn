"use client";

import { Badge } from "@jendal-workspace/ui/components/badge";
import { Button, buttonVariants } from "@jendal-workspace/ui/components/button";
import type { TableColumn } from "@jendal-workspace/ui/components/motion/table";
import { useQuery } from "@tanstack/react-query";
import { Package } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { DataList } from "@/components/data-list";
import { categoryDescendantIds, flattenCategories } from "@/lib/catalog-categories";
import DigitalProducts from "@/components/catalog/digital-products";
import Loader from "@/components/loader";
import { ListPage, PageHeader } from "@/components/page-composition";
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
  const categories = useQuery({ ...trpc.catalog.listCategories.queryOptions({ storeSlug }), retry: false, meta: { silent: true } });
  const categoryPath = new Map(flattenCategories(categories.data ?? []).map((category) => [category.id, category.path]));
  type Product = NonNullable<typeof products.data>[number];
  const price = (product: Product) => product.priceLow === null
    ? "No price"
    : product.priceLow === product.priceHigh
      ? formatMinor(product.priceLow, "USD")
      : `${formatMinor(product.priceLow, "USD")}–${formatMinor(product.priceHigh ?? product.priceLow, "USD")}`;
  const columns: TableColumn<Product>[] = [
    {
      key: "title",
      header: "Premade item",
      sortable: true,
      sortValue: (product) => product.title.toLocaleLowerCase(),
      cell: (product) => (
        <span className="flex min-w-0 items-center gap-3">
          <ProductThumb imageKey={product.imageKey} />
          <span className="grid min-w-0">
            <Link href={`/${storeSlug}/products/${product.id}`} className="truncate font-medium underline-offset-4 hover:underline">{product.title}</Link>
            <span className="truncate text-xs text-muted-foreground">{product.variantCount} {product.variantCount === 1 ? "variant" : "variants"} · {product.totalStock} in stock</span>
          </span>
        </span>
      ),
    },
    { key: "category", header: "Category", width: "190px", sortable: true, sortValue: (product) => categoryPath.get(product.departmentId ?? "") ?? "", cell: (product) => <span className="truncate text-muted-foreground">{product.departmentId ? categoryPath.get(product.departmentId) ?? "Category" : "No category"}</span> },
    { key: "price", header: "Price", width: "170px", align: "right", sortable: true, sortValue: (product) => product.priceLow ?? -1, cell: (product) => <span className="whitespace-nowrap tabular-nums">{price(product)}</span> },
    { key: "stock", header: "Stock", width: "110px", align: "right", sortable: true, sortValue: (product) => product.totalStock, cell: (product) => <span className="tabular-nums">{product.totalStock}</span> },
    { key: "status", header: "Status", width: "140px", sortable: true, sortValue: (product) => product.status, cell: (product) => <Badge tone={product.status === "published" ? "good" : "neutral"}>{product.status === "published" ? "Published" : "Draft"}</Badge> },
  ];

  if (products.isPending) return <Loader />;

  return (
    <ListPage>
      <PageHeader
        title="Premade items"
        description="Ready-made items clients buy from the shop."
        actions={
          <>
            <Link href={`/${storeSlug}/categories`} className={buttonVariants({ variant: "outline" })}>Categories</Link>
            <Link href={`/${storeSlug}/products/new`} className={buttonVariants()}>Add premade item</Link>
          </>
        }
      />
      {products.isError ? <div role="alert" className="space-y-3 rounded-[10px] border p-5 text-sm"><p>The premade items couldn’t be loaded.</p><Button type="button" variant="outline" size="sm" onClick={() => void products.refetch()}>Try again</Button></div> : null}
      {products.isSuccess ? (
        <DataList
          label="Premade items"
          rows={products.data}
          columns={columns}
          getRowId={(product) => product.id}
          searchText={(product) => product.title}
          searchLabel="Search premade items"
          views={[
            { key: "all", label: "All" },
            { key: "published", label: "Published", match: (product) => product.status === "published" },
            { key: "draft", label: "Drafts", match: (product) => product.status === "draft" },
          ]}
          filters={(categories.data?.length ?? 0) > 0 ? [{ key: "category", label: "Category", options: [...flattenCategories(categories.data ?? []).map((category) => ({ value: category.id, label: category.path })), { value: "none", label: "No category" }], match: (product: Product, value: string) => value === "none" ? !product.departmentId : product.departmentId !== null && categoryDescendantIds(categories.data ?? [], value).has(product.departmentId) }] : []}
          defaultSort={{ key: "title", direction: "asc" }}
          empty={{ title: "No premade items yet", text: "Add your first item — start from a link, a photo, or a blank form." }}
          noun={{ one: "item", many: "items" }}
        />
      ) : null}
    </ListPage>
  );
}

// A product without a usable image shows a package icon instead of an empty or broken frame.
function ProductThumb({ imageKey }: { imageKey: string | null }) {
  const [broken, setBroken] = useState(false);
  if (imageKey && !broken) {
    return <img src={productImageUrl(imageKey)} alt="" onError={() => setBroken(true)} className="size-12 rounded-md object-cover outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10" />;
  }
  return (
    <div aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground well">
      <Package className="size-5" />
    </div>
  );
}
