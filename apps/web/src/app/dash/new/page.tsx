import { getStoreUrlParts, requireSession } from "@/lib/server-api";

import CreateStoreForm from "./create-store-form";

export default async function NewStorePage() {
  await requireSession();
  const urlParts = await getStoreUrlParts();

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-6 md:px-7 md:py-8">
      <h1 className="font-heading text-3xl">Create your store</h1>
      <p className="mt-1 text-sm text-muted-foreground">You can rename the store later. Its address cannot be changed.</p>
      <CreateStoreForm urlParts={urlParts} />
    </main>
  );
}
