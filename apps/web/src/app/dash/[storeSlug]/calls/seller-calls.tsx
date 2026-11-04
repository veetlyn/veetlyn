"use client";

import { useQuery } from "@tanstack/react-query";

import Loader from "@/components/loader";
import TeamNotFound from "@/components/services-team/team-not-found";
import { trpc } from "@/utils/trpc";

import TeamCalls from "./team-calls";

// A seller's calls (either kind): the list holds every call at the seller and below; a call started from a project
// page opens on that project.
export default function SellerCalls({
  slug,
  assistantName,
  callId,
  projectId,
}: {
  slug: string;
  assistantName: string;
  callId: string | null;
  projectId: string | null;
}) {
  const seller = useQuery({ ...trpc.agent.seller.queryOptions({ slug }), retry: false, meta: { silent: true } });
  if (seller.isPending) return <Loader />;
  const teamId = seller.data?.scope.seller?.id;
  if (!teamId) return <TeamNotFound />;
  const listNode = { kind: "seller" as const, teamId };
  return (
    <TeamCalls
      listNode={listNode}
      askNode={projectId ? { kind: "record", teamId, record: { type: "project", id: projectId } } : listNode}
      callsPath={`/${slug}/calls`}
      projectHref={(id) => `/${slug}/projects/${id}`}
      assistantName={assistantName}
      callId={callId}
    />
  );
}
