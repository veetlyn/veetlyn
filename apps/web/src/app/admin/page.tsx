import { buttonVariants } from "@jendal-workspace/ui/components/button";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getStoreUrlParts, listMyStores, requireSession } from "@/lib/server-api";
import { storeUrl } from "@/lib/store-url";

const STATUS_LABEL: Record<string, string> = { draft: "Draft", active: "Live", suspended: "Suspended" };

export default async function AdminHome() {
  await requireSession();
  const organizations = (await listMyStores()).filter((o) => o.stores.length > 0);
  if (organizations.length === 0) redirect("/new");
  const urlParts = await getStoreUrlParts();

  return (
    <main className="container mx-auto max-w-3xl space-y-8 px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Your stores</h1>
        {organizations.some((o) => o.canCreateStores) ? (
          <Link href="/new" className={buttonVariants({ variant: "outline" })}>
            Create a store
          </Link>
        ) : null}
      </div>
      {organizations.map((organization) => (
        <section key={organization.id} aria-labelledby={`org-${organization.id}`} className="space-y-3">
          <h2 id={`org-${organization.id}`} className="text-sm font-medium text-muted-foreground">
            {organization.name}
          </h2>
          <ul className="divide-y border">
            {organization.stores.map((store) => (
              <li key={store.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <Link href={`/${store.slug}`} className="font-medium hover:underline">
                    {store.name}
                  </Link>
                  <p className="truncate text-sm text-muted-foreground">{storeUrl(store.slug, urlParts)}</p>
                </div>
                <span className="shrink-0 text-sm text-muted-foreground">{STATUS_LABEL[store.status] ?? store.status}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
