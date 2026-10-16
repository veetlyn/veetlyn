"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ClientProjectView } from "@/components/client-project-view";
import Loader from "@/components/loader";
import { clientWaitsOnTeam, isNotFoundError, PROJECT_REFRESH_MS } from "@/lib/project-refresh";
import { trpc, trpcClient } from "@/utils/trpc";

// The client project page (services spec §5.2): the signed link is the credential, so this page
// works without an account. Accepting a quote or an amendment is one click from here.
export default function ClientProject({ token }: { token: string }) {
  const queryClient = useQueryClient();
  const view = useQuery({
    ...trpc.project.clientGet.queryOptions({ token }),
    retry: false,
    refetchInterval: (query) =>
      query.state.data && !isNotFoundError(query.state.error) && clientWaitsOnTeam(query.state.data) ? PROJECT_REFRESH_MS : false,
    meta: { quietRefetchErrors: true },
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.project.clientGet.queryOptions({ token }).queryKey });

  const acceptQuote = useMutation(trpc.project.clientAcceptQuote.mutationOptions({ onSuccess: refresh }));
  const acceptAmendment = useMutation(trpc.project.clientAcceptAmendment.mutationOptions({ onSuccess: refresh }));
  const declineAmendment = useMutation(trpc.project.clientDeclineAmendment.mutationOptions({ onSuccess: refresh }));
  const acceptDelivery = useMutation(trpc.project.clientAcceptDelivery.mutationOptions({ onSuccess: refresh }));
  const requestChanges = useMutation(trpc.project.clientRequestChanges.mutationOptions({ onSuccess: refresh }));

  if (view.isPending) return <Loader />;
  // A failed refetch keeps the last data, so a missed poll does not replace the page with this message.
  if (!view.data) {
    return (
      <main className="container mx-auto max-w-2xl space-y-4 px-4 py-16">
        <h1 className="text-2xl font-semibold">This link is not valid</h1>
        <p className="text-sm text-muted-foreground">Ask the team to send you the project link again.</p>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-2xl px-4 py-10">
      <ClientProjectView
        data={view.data}
        fileUrl={async (deliveryId) => (await trpcClient.project.clientDeliveryFileUrl.query({ token, deliveryId })).url}
        actions={{
          acceptQuote: (quoteId) => acceptQuote.mutate({ token, quoteId }),
          acceptAmendment: (amendmentId) => acceptAmendment.mutate({ token, amendmentId }),
          declineAmendment: (amendmentId) => declineAmendment.mutate({ token, amendmentId }),
          acceptDelivery: (deliveryId) => acceptDelivery.mutate({ token, deliveryId }),
          requestChanges: async (deliveryId, note) => {
            await requestChanges.mutateAsync({ token, deliveryId, note });
          },
          resetDelivery: () => {
            acceptDelivery.reset();
            requestChanges.reset();
          },
          quoteBusy: acceptQuote.isPending,
          amendmentBusy: acceptAmendment.isPending || declineAmendment.isPending,
          deliveryBusy: acceptDelivery.isPending || requestChanges.isPending,
          deliveryError: acceptDelivery.error ?? requestChanges.error,
          actionError: acceptQuote.error ?? acceptAmendment.error ?? declineAmendment.error,
        }}
      />
    </main>
  );
}
