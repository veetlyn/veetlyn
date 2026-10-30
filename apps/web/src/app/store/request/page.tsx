import { notFound } from "next/navigation";

import { sellerMetadata } from "@/lib/seller-site";
import { fetchSellerPage } from "@/lib/server-api";

import RequestForm from "./request-form";

// The form is a step, not content; the seller page carries the services for search.
export function generateMetadata() {
  return sellerMetadata({ path: "/request", title: "Request a quote", index: false });
}

export default async function RequestPage({ searchParams }: { searchParams: Promise<{ offering?: string }> }) {
  const page = await fetchSellerPage();
  if (!page || page.product !== "services") notFound();
  const { offering } = await searchParams;
  return <RequestForm page={page} preselectedOfferingId={offering ?? null} />;
}
