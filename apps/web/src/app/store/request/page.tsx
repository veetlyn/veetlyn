import { notFound } from "next/navigation";

import { fetchSellerPage } from "@/lib/server-api";

import RequestForm from "./request-form";

export default async function RequestPage({ searchParams }: { searchParams: Promise<{ offering?: string }> }) {
  const page = await fetchSellerPage();
  if (!page || page.product !== "services") notFound();
  const { offering } = await searchParams;
  return <RequestForm page={page} preselectedOfferingId={offering ?? null} />;
}
