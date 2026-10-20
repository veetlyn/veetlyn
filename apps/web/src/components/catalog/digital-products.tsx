"use client";

import { Button, buttonVariants } from "@jendal-workspace/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";

import TurnOffStoreButton from "@/components/catalog/turn-off-store-button";
import Loader from "@/components/loader";
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
  if (team.isError) return <p role="alert">The products couldn&apos;t be loaded.</p>;

  const { settings, role } = team.data;
  const currency = settings?.currency ?? "USD";

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
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 md:px-7 md:py-8">
      <div className="flex items-baseline justify-between gap-4">
        <div className="space-y-1">
          <Link href={`/${teamSlug}`} className="text-sm text-muted-foreground">
            {teamSlug}
          </Link>
          <h1 className="font-heading text-3xl">Products</h1>
        </div>
        {role === "admin" ? (
          <Link href={`/${teamSlug}/products/new`} className={buttonVariants()}>
            Add product
          </Link>
        ) : null}
      </div>

      {products.isPending && <Loader />}
      {products.isError && <p role="alert">{products.error.message}</p>}

      {products.data?.length === 0 && (
        <section className="panel grid justify-items-center gap-2 p-10 text-center">
          <p className="font-medium">No products yet</p>
          <p className="text-sm text-muted-foreground">Add your first download: a title, a price and the file buyers get.</p>
        </section>
      )}

      {products.data && products.data.length > 0 && (
        <ul className="panel divide-y overflow-hidden">
          {products.data.map((product) => (
            <li key={product.id}>
              <Link href={`/${teamSlug}/products/${product.id}`} className="flex items-center gap-4 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{product.title}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {product.status === "published" ? "Published" : "Draft"} · {formatMinor(product.priceMinor, currency)} ·{" "}
                    {product.fileName ?? "No file"}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {role === "admin" ? <TurnOffStoreButton teamSlug={teamSlug} /> : null}
    </main>
  );
}
