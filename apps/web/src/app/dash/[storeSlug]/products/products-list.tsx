"use client";

import { Badge } from "@jendal-workspace/ui/components/badge";
import { Button, buttonVariants } from "@jendal-workspace/ui/components/button";
import type { TableColumn } from "@jendal-workspace/ui/components/motion/table";
import { useQuery } from "@tanstack/react-query";
import { Package } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { DataList } from "@/components/data-list";
import DigitalProducts from "@/components/catalog/digital-products";
import Loader from "@/components/loader";
import { ListPage, SummaryStrip } from "@/components/page-composition";
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
    { key: "price", header: "Price", width: "170px", align: "right", sortable: true, sortValue: (product) => product.priceLow ?? -1, cell: (product) => <span className="whitespace-nowrap tabular-nums">{price(product)}</span> },
    { key: "stock", header: "Stock", width: "110px", align: "right", sortable: true, sortValue: (product) => product.totalStock, cell: (product) => <span className="tabular-nums">{product.totalStock}</span> },
    { key: "status", header: "Status", width: "140px", sortable: true, sortValue: (product) => product.status, cell: (product) => <Badge tone={product.status === "published" ? "good" : "neutral"}>{product.status === "published" ? "Published" : "Draft"}</Badge> },
  ];

  if (products.isPending) return <Loader />;

  return (
    <ListPage>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-heading text-3xl">Premade items</h1>
          <p className="text-sm text-muted-foreground">Ready-made items clients buy from the shop.</p>
        </div>
        <Link href={`/${storeSlug}/products/new`} className={buttonVariants()}>
          Add premade item
        </Link>
      </div>

      {products.isSuccess && products.data.length > 0 ? (
        <SummaryStrip label="Catalogue summary">
          <p className="text-sm"><span className="font-medium">{products.data.filter((product) => product.status === "published").length} published</span> <span className="text-muted-foreground">items live in the shop</span></p>
          <p className="text-sm text-muted-foreground">{products.data.filter((product) => product.status === "draft").length} drafts</p>
        </SummaryStrip>
      ) : null}
      {products.isError ? <div role="alert" className="space-y-3 rounded-[10px] border p-5 text-sm"><p>The premade items couldn’t be loaded.</p><Button type="button" variant="outline" size="sm" onClick={() => void products.refetch()}>Try again</Button></div> : null}
      {products.isSuccess ? (
        <DataList
          label="Premade items"
          rows={products.data}
          columns={columns}
          getRowId={(product) => product.id}
          searchText={(product) => product.title}
          searchLabel="Search premade items"
          filters={[{ key: "status", label: "Statuses", options: [{ value: "published", label: "Published" }, { value: "draft", label: "Draft" }], match: (product, value) => product.status === value }]}
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
    return <img src={productImageUrl(imageKey)} alt="" onError={() => setBroken(true)} className="size-12 rounded-md border object-cover" />;
  }
  return (
    <div aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground well">
      <Package className="size-5" />
    </div>
  );
}
