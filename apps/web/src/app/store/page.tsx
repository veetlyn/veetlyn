import { notFound } from "next/navigation";

import { fetchStoreInfo } from "@/lib/server-api";

export default async function StorefrontHome() {
  const store = await fetchStoreInfo();
  if (!store) notFound();

  return (
    <main className="container mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">{store.name}</h1>
      <p className="text-muted-foreground">This store is getting ready.</p>
    </main>
  );
}
