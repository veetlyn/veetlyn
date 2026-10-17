import { requireSession } from "@/lib/server-api";

import ProductsList from "./products-list";

export default async function ProductsPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  await requireSession();
  const { storeSlug } = await params;
  return <ProductsList storeSlug={storeSlug} />;
}
