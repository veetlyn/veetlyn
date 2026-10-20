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
    meta: { silent: true },
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.project.clientGet.queryOptions({ token }).queryKey });

  const acceptQuote = useMutation(trpc.project.clientAcceptQuote.mutationOptions({ onSuccess: refresh }));
  const acceptAmendment = useMutation(trpc.project.clientAcceptAmendment.mutationOptions({ onSuccess: refresh }));
  const declineAmendment = useMutation(trpc.project.clientDeclineAmendment.mutationOptions({ onSuccess: refresh }));
  const acceptDelivery = useMutation(trpc.project.clientAcceptDelivery.mutationOptions({ onSuccess: refresh }));
  const requestChanges = useMutation(trpc.project.clientRequestChanges.mutationOptions({ onSuccess: refresh }));
  const post = useMutation(trpc.project.clientPost.mutationOptions({ onSuccess: refresh }));
  const answer = useMutation(trpc.project.clientAnswer.mutationOptions({ onSuccess: refresh }));

  if (view.isPending) return <Loader />;
  // A failed refetch keeps the last data, so a missed poll does not replace the page with this message.
  if (!view.data) {
    if (view.error?.data?.code === "FORBIDDEN") {
      return (
        <main className="mx-auto w-full max-w-2xl space-y-4 px-4 py-10 md:px-7 md:py-16">
          <h1 className="font-heading text-3xl">This link is for the client</h1>
          <p className="text-sm text-muted-foreground">{view.error.message}</p>
        </main>
      );
    }
    return (
      <main className="mx-auto w-full max-w-2xl space-y-4 px-4 py-10 md:px-7 md:py-16">
        <h1 className="font-heading text-3xl">This link is not valid</h1>
        <p className="text-sm text-muted-foreground">Ask the team to send you the project link again.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 md:py-14">
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
          post: async ({ body, teamOnly }) => {
            await post.mutateAsync({ token, body, teamOnly });
          },
          answer: async (questionId, body) => {
            await answer.mutateAsync({ token, questionId, body });
          },
          messageBusy: post.isPending || answer.isPending,
          messageError: post.error ?? answer.error,
        }}
      />
    </main>
  );
}
