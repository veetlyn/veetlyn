import { requireSession } from "@/lib/server-api";

import NewProduct from "./new-product";

export default async function NewProductPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;
  return <NewProduct storeSlug={storeSlug} />;
}
