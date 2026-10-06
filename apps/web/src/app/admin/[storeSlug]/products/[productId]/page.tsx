import { requireSession } from "@/lib/server-api";

import EditProduct from "./edit-product";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ storeSlug: string; productId: string }>;
}) {
  await requireSession();
  const { storeSlug, productId } = await params;
  return <EditProduct storeSlug={storeSlug} productId={productId} />;
}
