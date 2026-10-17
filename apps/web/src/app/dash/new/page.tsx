import { getStoreUrlParts, requireSession } from "@/lib/server-api";

import CreateStoreForm from "./create-store-form";

export default async function NewStorePage() {
  await requireSession();
  const urlParts = await getStoreUrlParts();

  return (
    <main className="container mx-auto max-w-lg px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Create your store</h1>
      <p className="mt-1 text-sm text-muted-foreground">You can rename the store later. Its address cannot be changed.</p>
      <CreateStoreForm urlParts={urlParts} />
    </main>
  );
}
