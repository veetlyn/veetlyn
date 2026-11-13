"use client";

import { Button, buttonVariants } from "@jendal-workspace/ui/components/button";
import { Badge } from "@jendal-workspace/ui/components/badge";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";

import TurnOffStoreButton from "@/components/catalog/turn-off-store-button";
import { DataList } from "@/components/data-list";
import { categoryDescendantIds, flattenCategories } from "@/lib/catalog-categories";
import Loader from "@/components/loader";
import { ListPage, PageHeader } from "@/components/page-composition";
import { formatMinor } from "@/lib/money";
import { trpc } from "@/utils/trpc";

export default function DigitalProducts({ teamSlug }: { teamSlug: string }) {
  const queryClient = useQueryClient();
  const team = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const products = useQuery({
    ...trpc.catalog.digitalList.queryOptions({ storeSlug: teamSlug }),
    enabled: team.data?.settings?.storeEnabled === true,
    retry: false,
    meta: { silent: true },
  });
  const categories = useQuery({ ...trpc.catalog.listCategories.queryOptions({ storeSlug: teamSlug }), retry: false, meta: { silent: true } });
  const enable = useMutation(
    trpc.servicesTeam.setStoreEnabled.mutationOptions({
      onSuccess: () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.get.queryKey({ teamSlug }) }),
          queryClient.invalidateQueries({ queryKey: trpc.seller.preview.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.seller.status.queryKey() }),
        ]),
    }),
  );

  if (team.isPending) return <Loader />;
  if (team.isError) return <main className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 md:px-7 md:py-8">
    <h1 className="font-heading text-3xl">Premade items unavailable</h1>
    <p role="alert" className="text-sm text-muted-foreground">{team.error.message}</p>
    <Button type="button" variant="outline" onClick={() => void team.refetch()}>Try again</Button>
  </main>;

  const { settings, role } = team.data;
  const currency = settings?.currency ?? "USD";
  const categoryPath = new Map(flattenCategories(categories.data ?? []).map((category) => [category.id, category.path]));

  if (!settings?.storeEnabled) {
    return (
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 md:px-7 md:py-8">
        <div className="space-y-1">
          <Link href={`/${teamSlug}`} className="text-sm text-muted-foreground">
            {teamSlug}
          </Link>
          <h1 className="font-heading text-3xl">Premade items</h1>
        </div>
        <section className="panel grid justify-items-center gap-2 p-10 text-center">
          <p className="font-medium">Sell digital downloads</p>
          <p className="text-sm text-muted-foreground">
            Turn on the store to sell files (presets, templates, icons) from your seller page.
          </p>
          <Button
            type="button"
            className="justify-self-center"
            onClick={() => enable.mutate({ teamSlug, enabled: true })}
            disabled={role !== "admin" || enable.isPending}
          >
            {enable.isPending ? "Turning on…" : "Turn on the store"}
          </Button>
          {role !== "admin" ? <p className="text-sm text-muted-foreground">Only an admin can turn on the store.</p> : null}
          {enable.error ? (
            <p role="alert" className="text-sm text-destructive">
              {enable.error.message}
            </p>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <ListPage>
      <PageHeader
        title="Premade items"
        description="Ready-made downloads clients buy from your seller page."
        actions={
          <>
            <Link href={`/${teamSlug}/categories`} className={buttonVariants({ variant: "outline" })}>Categories</Link>
            {role === "admin" ? <Link href={`/${teamSlug}/products/new`} className={buttonVariants()}>Add premade item</Link> : null}
          </>
        }
      />

      {products.isPending ? <Loader /> : null}
      {products.isError ? <div role="alert" className="space-y-3 rounded-[10px] border p-5 text-sm"><p>{products.error.message}</p><Button type="button" variant="outline" size="sm" onClick={() => void products.refetch()}>Try again</Button></div> : null}
      {products.isSuccess ? (
        <DataList
          label="Premade items"
          rows={products.data}
          columns={[
            {
              key: "title",
              header: "Item",
              sortable: true,
              sortValue: (product) => product.title.toLocaleLowerCase(),
              cell: (product) => (
                <span className="grid min-w-0">
                  <Link href={`/${teamSlug}/products/${product.id}`} className="truncate font-medium underline-offset-4 hover:underline">{product.title}</Link>
                  <span className="truncate text-xs text-muted-foreground">{product.fileName ?? "Add a file before publishing"}</span>
                </span>
              ),
            },
            { key: "category", header: "Category", width: "190px", sortable: true, sortValue: (product) => categoryPath.get(product.departmentId ?? "") ?? "", cell: (product) => <span className="truncate text-muted-foreground">{product.departmentId ? categoryPath.get(product.departmentId) ?? "Category" : "No category"}</span> },
            { key: "price", header: "Price", width: "120px", align: "right", sortable: true, sortValue: (product) => product.priceMinor, cell: (product) => <span className="whitespace-nowrap tabular-nums">{formatMinor(product.priceMinor, currency)}</span> },
            { key: "status", header: "Status", width: "140px", sortable: true, sortValue: (product) => product.status, cell: (product) => <Badge tone={product.status === "published" ? "good" : "neutral"}>{product.status === "published" ? "Published" : "Draft"}</Badge> },
          ]}
          getRowId={(product) => product.id}
          searchText={(product) => `${product.title} ${product.fileName ?? ""}`}
          searchLabel="Search premade items"
          views={[
            { key: "all", label: "All" },
            { key: "published", label: "Published", match: (product) => product.status === "published" },
            { key: "draft", label: "Drafts", match: (product) => product.status !== "published" },
            { key: "nofile", label: "Without a file", match: (product) => !product.fileName },
          ]}
          filters={(categories.data?.length ?? 0) > 0 ? [{ key: "category", label: "Category", options: [...flattenCategories(categories.data ?? []).map((category) => ({ value: category.id, label: category.path })), { value: "none", label: "No category" }], match: (product: { departmentId: string | null }, value: string) => value === "none" ? !product.departmentId : product.departmentId !== null && categoryDescendantIds(categories.data ?? [], value).has(product.departmentId) }] : []}
          defaultSort={{ key: "title", direction: "asc" }}
          empty={{ title: "No premade items yet", text: "Add your first download: a title, a price and the file buyers get." }}
          noun={{ one: "item", many: "items" }}
        />
      ) : null}

      {role === "admin" ? (
        <section aria-labelledby="store-h" className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
          <div>
            <h2 id="store-h" className="text-sm font-medium">On your seller page</h2>
            <p className="text-sm text-muted-foreground">Turning this off hides premade items from your seller page.</p>
          </div>
          <TurnOffStoreButton teamSlug={teamSlug} />
        </section>
      ) : null}
    </ListPage>
  );
}
