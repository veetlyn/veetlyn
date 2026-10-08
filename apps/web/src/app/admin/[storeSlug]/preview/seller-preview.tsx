"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import Loader from "@/components/loader";
import SellerPage from "@/components/seller-page/seller-page";
import StoreHome from "@/components/seller-page/store-home";
import TeamNotFound from "@/components/services-team/team-not-found";
import { type StoreUrlParts, storeUrl } from "@/lib/store-url";
import { trpc } from "@/utils/trpc";

export default function SellerPreview({ teamSlug, urlParts }: { teamSlug: string; urlParts: StoreUrlParts }) {
  const result = useQuery({ ...trpc.seller.preview.queryOptions({ teamSlug }), retry: false });

  if (result.isPending) return <Loader />;
  if (result.isError) return <TeamNotFound />;

  const page = result.data;
  const url = storeUrl(page.slug, urlParts);

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b bg-muted px-4 py-2 text-sm">
        {page.status === "active" ? (
          <p>
            Preview. This page is live at{" "}
            <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
              {url}
            </a>
            .
          </p>
        ) : page.status === "suspended" ? (
          <p>Preview. This seller is suspended; the page is hidden from visitors.</p>
        ) : (
          <p>Preview. This page is a draft; only your team can see it.</p>
        )}
        <Link href={`/${teamSlug}`} className="underline underline-offset-4">
          Back to the dashboard
        </Link>
      </div>
      {page.product === "services" ? <SellerPage page={page} /> : <StoreHome name={page.name} />}
    </>
  );
}
