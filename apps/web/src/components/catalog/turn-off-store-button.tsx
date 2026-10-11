"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";

export const TURN_OFF_STORE_CONFIRM =
  "Turn off the store? Your products leave your seller page and buyers can't check out until you turn it back on.";

export default function TurnOffStoreButton({ teamSlug }: { teamSlug: string }) {
  const queryClient = useQueryClient();
  const disable = useMutation(
    trpc.servicesTeam.setStoreEnabled.mutationOptions({
      onSuccess: () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.get.queryKey({ teamSlug }) }),
          queryClient.invalidateQueries({ queryKey: trpc.seller.preview.queryKey() }),
          // Published products stop counting toward publishing once the store is off.
          queryClient.invalidateQueries({ queryKey: trpc.seller.status.queryKey() }),
        ]),
    }),
  );

  return (
    <div className="grid justify-items-start gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          if (window.confirm(TURN_OFF_STORE_CONFIRM)) disable.mutate({ teamSlug, enabled: false });
        }}
        disabled={disable.isPending}
      >
        {disable.isPending ? "Turning off…" : "Turn off the store"}
      </Button>
      {disable.error ? (
        <p role="alert" className="text-sm text-destructive">
          {disable.error.message}
        </p>
      ) : null}
    </div>
  );
}
