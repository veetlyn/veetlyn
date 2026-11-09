"use client";

import { Button, buttonVariants } from "@jendal-workspace/ui/components/button";
import { Badge } from "@jendal-workspace/ui/components/badge";
import { Input } from "@jendal-workspace/ui/components/input";
import { nativeSelectClass } from "@jendal-workspace/ui/lib/native-select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import TurnOffStoreButton from "@/components/catalog/turn-off-store-button";
import Loader from "@/components/loader";
import { formatMinor } from "@/lib/money";
import { trpc } from "@/utils/trpc";

export default function DigitalProducts({ teamSlug }: { teamSlug: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const team = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const products = useQuery({
    ...trpc.catalog.digitalList.queryOptions({ storeSlug: teamSlug }),
    enabled: team.data?.settings?.storeEnabled === true,
    retry: false,
    meta: { silent: true },
  });
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
    <h1 className="font-heading text-3xl">Products unavailable</h1>
    <p role="alert" className="text-sm text-muted-foreground">{team.error.message}</p>
    <Button type="button" variant="outline" onClick={() => void team.refetch()}>Try again</Button>
  </main>;

  const { settings, role } = team.data;
  const currency = settings?.currency ?? "USD";
  const matching = (products.data ?? []).filter((product) => (status === "all" || product.status === status) && `${product.title} ${product.fileName ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  if (!settings?.storeEnabled) {
    return (
      <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 md:px-7 md:py-8">
        <div className="space-y-1">
          <Link href={`/${teamSlug}`} className="text-sm text-muted-foreground">
            {teamSlug}
          </Link>
          <h1 className="font-heading text-3xl">Products</h1>
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
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 md:px-7 md:py-8">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-heading text-3xl">Products</h1>
          <p className="text-sm text-muted-foreground">Digital downloads sold from your seller page.</p>
        </div>
        {role === "admin" ? (
          <Link href={`/${teamSlug}/products/new`} className={buttonVariants()}>
            Add product
          </Link>
        ) : null}
      </div>

      {products.isPending && <Loader />}
      {products.isError && <div role="alert" className="space-y-3 rounded-[10px] border p-5 text-sm"><p>{products.error.message}</p><Button type="button" variant="outline" size="sm" onClick={() => void products.refetch()}>Try again</Button></div>}
      {products.isSuccess && products.data.length > 0 ? <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="w-full sm:max-w-72"><span className="sr-only">Search products by title or file</span><Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products…" /></label>
        <label><span className="sr-only">Product status</span><select value={status} onChange={(event) => setStatus(event.target.value)} className={nativeSelectClass}><option value="all">All statuses</option><option value="published">Published</option><option value="draft">Draft</option></select></label>
      </div> : null}

      {products.data?.length === 0 && (
        <section className="panel grid justify-items-center gap-2 p-10 text-center">
          <p className="font-medium">No products yet</p>
          <p className="text-sm text-muted-foreground">Add your first download: a title, a price and the file buyers get.</p>
        </section>
      )}

      {products.data && products.data.length > 0 && matching.length === 0 ? <section className="rounded-[10px] border px-5 py-10 text-center">
        <h2 className="font-heading text-lg">No matching products</h2>
        <p className="mt-2 text-sm text-muted-foreground">Try another title, file name or status.</p>
        <Button type="button" variant="outline" className="mt-4" onClick={() => { setSearch(""); setStatus("all"); }}>Clear filters</Button>
      </section> : products.data && products.data.length > 0 && (
        <ul className="panel divide-y overflow-hidden">
          {matching.map((product) => (
            <li key={product.id}>
              <Link href={`/${teamSlug}/products/${product.id}`} className="flex flex-wrap items-center gap-4 p-4 hover:bg-accent/60">
                <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                  <p className="break-words font-medium">{product.title}</p>
                  <p className="mt-1 truncate text-sm text-muted-foreground">{product.fileName ?? "Add a file before publishing"}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3"><span className="font-tabular text-sm font-medium">{formatMinor(product.priceMinor, currency)}</span><Badge tone={product.status === "published" ? "good" : "neutral"}>{product.status === "published" ? "Published" : "Draft"}</Badge></div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {role === "admin" ? <details className="border-t pt-4"><summary className="cursor-pointer text-sm text-muted-foreground">Store settings</summary><div className="pt-4"><TurnOffStoreButton teamSlug={teamSlug} /></div></details> : null}
    </main>
  );
}
