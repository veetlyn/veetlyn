"use client";

import { useQuery } from "@tanstack/react-query";

import Loader from "@/components/loader";
import TeamNotFound from "@/components/services-team/team-not-found";
import type { StoreUrlParts } from "@/lib/store-url";
import { trpc } from "@/utils/trpc";

import ProjectDetail from "../projects/[projectId]/project-detail";
import ServicesTeamDashboard from "../services-team-dashboard";
import TeamCalls from "./team-calls";

// A seller's calls (either kind): the list holds every call at the seller and below; a call started from a project
// page opens on that project. Beside the conversation sits what it works on: the project, or the seller's home.
export default function SellerCalls({
  slug,
  assistantName,
  callId,
  projectId,
  urlParts,
  paypalEnvironment,
}: {
  slug: string;
  assistantName: string;
  callId: string | null;
  projectId: string | null;
  urlParts: StoreUrlParts;
  paypalEnvironment: string;
}) {
  const seller = useQuery({ ...trpc.agent.seller.queryOptions({ slug }), retry: false, meta: { silent: true } });
  if (seller.isPending) return <Loader />;
  const scope = seller.data?.scope.seller;
  if (!scope) return <TeamNotFound />;
  const teamId = scope.id;
  const services = scope.role.product === "services";
  const listNode = { kind: "seller" as const, teamId };
  return (
    <TeamCalls
      listNode={listNode}
      askNode={projectId ? { kind: "record", teamId, record: { type: "project", id: projectId } } : listNode}
      callsPath={`/${slug}/calls`}
      backHref={projectId ? `/${slug}/projects/${projectId}` : `/${slug}`}
      backLabel={scope.name}
      projectHref={(id) => `/${slug}/projects/${id}`}
      assistantName={assistantName}
      callId={callId}
      subject={
        services
          ? (onTable) =>
              onTable ? (
                <ProjectDetail teamSlug={slug} projectId={onTable} paypalEnvironment={paypalEnvironment} />
              ) : (
                <ServicesTeamDashboard teamSlug={slug} urlParts={urlParts} />
              )
          : undefined
      }
    />
  );
}
