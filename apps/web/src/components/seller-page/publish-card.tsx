"use client";

import { Button, buttonVariants } from "@jendal-workspace/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";

import { trpc } from "@/utils/trpc";

// id="publish": the setup checklists' "Publish" step links here.
export default function PublishCard({ teamSlug, publicUrl }: { teamSlug: string; publicUrl: string }) {
  const queryClient = useQueryClient();
  const status = useQuery({ ...trpc.seller.status.queryOptions({ teamSlug }), retry: false });

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.seller.status.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.seller.preview.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.get.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.store.get.queryKey() }),
    ]);
  }

  const publish = useMutation(trpc.seller.publish.mutationOptions({ onSuccess: refresh }));
  const unpublish = useMutation(trpc.seller.unpublish.mutationOptions({ onSuccess: refresh }));

  // The dashboard already handles a missing team, so a failed status read hides the card.
  if (status.isPending || status.isError) return null;

  const { product, status: sellerStatus, problem, canManage } = status.data;
  const error = publish.error ?? unpublish.error;

  function handleUnpublish() {
    if (!window.confirm("Unpublish? Visitors will see a not-found page until you publish again.")) return;
    unpublish.mutate({ teamSlug });
  }

  return (
    <section id="publish" className="grid scroll-mt-6 gap-3 border p-4">
      <h2 className="font-medium">{product === "services" ? "Seller page" : "Storefront"}</h2>
      <p className="text-sm">
        {sellerStatus === "draft" ? (
          "Draft: only your team can see it."
        ) : sellerStatus === "active" ? (
          <>
            Live at{" "}
            <a href={publicUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">
              {publicUrl}
            </a>
          </>
        ) : (
          "Suspended"
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href={`/${teamSlug}/preview`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Preview
        </Link>
        {canManage && sellerStatus === "draft" ? (
          <Button
            size="sm"
            onClick={() => publish.mutate({ teamSlug })}
            disabled={problem !== null || publish.isPending}
          >
            {publish.isPending ? "Publishing…" : "Publish"}
          </Button>
        ) : null}
        {canManage && sellerStatus === "active" ? (
          <Button size="sm" variant="outline" onClick={handleUnpublish} disabled={unpublish.isPending}>
            {unpublish.isPending ? "Unpublishing…" : "Unpublish"}
          </Button>
        ) : null}
      </div>
      {canManage && sellerStatus === "draft" && problem ? (
        <p className="text-sm text-muted-foreground">{problem}</p>
      ) : null}
      {!canManage ? <p className="text-sm text-muted-foreground">An admin publishes the page.</p> : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error.message}
        </p>
      ) : null}
    </section>
  );
}
