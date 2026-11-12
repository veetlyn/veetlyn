import { redirect } from "next/navigation";

// Service requests are listed with premade-item orders under Orders.
export default async function RequestsPage({ params }: { params: Promise<{ storeSlug: string }> }) {
  const { storeSlug } = await params;
  redirect(`/${encodeURIComponent(storeSlug)}/orders`);
}
