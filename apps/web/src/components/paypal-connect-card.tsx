"use client";

import { Button, buttonVariants } from "@jendal-workspace/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@jendal-workspace/ui/components/card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { payPalCardModel } from "@/lib/paypal-status";
import { trpc } from "@/utils/trpc";

const TONE_CLASS = {
  muted: "text-muted-foreground",
  success: "text-brand-text",
  problem: "text-destructive",
} as const;

// Generic PayPal connection card, keyed by team id: the store and services team dashboards mount it.
export default function PayPalConnectCard({ teamId }: { teamId: string }) {
  const queryClient = useQueryClient();
  const status = useQuery({ ...trpc.paypal.onboardingStatus.queryOptions({ teamId, refresh: false }), retry: false });
  // A disabled query fired manually: re-reads the integration from PayPal on demand.
  const recheck = useQuery({
    ...trpc.paypal.onboardingStatus.queryOptions({ teamId, refresh: true }),
    enabled: false,
    retry: false,
  });
  const start = useMutation(
    trpc.paypal.startOnboarding.mutationOptions({
      onSuccess: ({ actionUrl }) => window.location.assign(actionUrl),
    }),
  );

  // Hide the card when PayPal is not configured (PRECONDITION_FAILED) or the query failed:
  // the dashboard's detail row still shows the raw connection state.
  if (status.isPending || status.isError) return null;

  const model = payPalCardModel(status.data);

  async function handleRecheck() {
    const result = await recheck.refetch();
    if (result.data) {
      queryClient.setQueryData(trpc.paypal.onboardingStatus.queryKey({ teamId, refresh: false }), result.data);
      // team.paypal_merchant_id may have changed: refresh whatever shows the team record.
      await queryClient.invalidateQueries({ queryKey: [["store"]] });
      await queryClient.invalidateQueries({ queryKey: [["servicesTeam"]] });
      // Publishing needs PayPal, so the publish card's rule check changes too.
      await queryClient.invalidateQueries({ queryKey: [["seller"]] });
    }
  }

  return (
    // id="paypal": the setup checklists' "Connect PayPal" step links here.
    <Card id="paypal" className="scroll-mt-6">
      <CardHeader>
        <CardTitle>PayPal payments</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className={`text-sm font-medium ${TONE_CLASS[model.tone]}`}>{model.title}</p>
        <p className="text-sm text-muted-foreground">{model.detail}</p>
        {model.action === "connect" && (
          <Button onClick={() => start.mutate({ teamId })} disabled={start.isPending}>
            {start.isPending ? "Opening PayPal…" : model.actionLabel}
          </Button>
        )}
        {model.action === "resume" && status.data.actionUrl && (
          <div className="flex gap-2">
            {/* A real link: it navigates to PayPal, so it keeps link semantics (no button role). */}
            <a href={status.data.actionUrl} className={buttonVariants()}>
              {model.actionLabel}
            </a>
            {/* The stored action_url expires after one use (Fact 6); "Start over" mints a fresh
                referral and its onSuccess navigates straight to the new PayPal link. */}
            <Button variant="outline" onClick={() => start.mutate({ teamId })} disabled={start.isPending}>
              {start.isPending ? "Opening PayPal…" : "Start over"}
            </Button>
          </div>
        )}
        {model.action === "refresh" && (
          <Button variant="outline" onClick={handleRecheck} disabled={recheck.isFetching}>
            {recheck.isFetching ? "Checking…" : model.actionLabel}
          </Button>
        )}
        {start.isError && (
          <p className="text-sm text-destructive" role="alert">
            {start.error.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
