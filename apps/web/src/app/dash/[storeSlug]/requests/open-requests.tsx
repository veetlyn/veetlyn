"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import Loader from "@/components/loader";
import { ListPage, SummaryStrip } from "@/components/page-composition";
import { trpc } from "@/utils/trpc";

const HOUR_MS = 3_600_000;

// The time comes from the request's pending expiry under the team's pinned rules; none once the team answered.
function windowLabel(respondBy: Date | null, now: number): string {
  if (!respondBy) return "No answer deadline";
  const hours = Math.ceil((respondBy.getTime() - now) / HOUR_MS);
  if (hours <= 0) return "Expiring now";
  return hours === 1 ? "1 hour left to answer" : `${hours} hours left to answer`;
}

export default function OpenRequests({ teamSlug }: { teamSlug: string }) {
  const requests = useQuery({ ...trpc.project.openRequests.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });

  if (requests.isPending) return <Loader />;
  if (requests.isError) {
    return (
      <ListPage>
        <h1 className="font-heading text-3xl">Requests unavailable</h1>
        <p className="text-sm text-muted-foreground">{requests.error.message}</p>
      </ListPage>
    );
  }

  const now = Date.now();
  const nextDeadline = requests.data
    .map((request) => request.respondBy)
    .filter((respondBy) => respondBy !== null)
    .sort()[0];
  return (
    <ListPage>
      <div className="space-y-1">
        <h1 className="font-heading text-3xl">Requests</h1>
        <p className="text-sm text-muted-foreground">
          Requests you can answer: ask the client a question, send a quote, or leave it to the team.
        </p>
      </div>
      {requests.data.length > 0 ? (
        <SummaryStrip label="Needs attention">
          <p className="text-sm">
            <span className="font-medium">
              {requests.data.length} open {requests.data.length === 1 ? "request" : "requests"}
            </span>{" "}
            <span className="text-muted-foreground">waiting for an answer</span>
          </p>
          <p className="text-sm text-muted-foreground">{windowLabel(nextDeadline ? new Date(nextDeadline) : null, now)}</p>
        </SummaryStrip>
      ) : null}
      {requests.data.length === 0 ? (
        <div className="panel grid justify-items-center gap-2 p-10 text-center">
          <p className="font-heading text-lg">No open requests</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            New requests for your departments show here as clients send them.
          </p>
        </div>
      ) : (
        <ul className="panel divide-y overflow-hidden">
          {requests.data.map((request) => (
            <li key={request.id}>
              <Link
                href={`/${teamSlug}/projects/${request.id}`}
                className="grid gap-1 px-4 py-3.5 transition-colors hover:bg-accent/60"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <p className="truncate font-medium">{request.title}</p>
                  <p className="shrink-0 text-sm text-muted-foreground">{windowLabel(request.respondBy ? new Date(request.respondBy) : null, now)}</p>
                </div>
                <p className="line-clamp-2 text-sm text-muted-foreground">{request.brief}</p>
                <p className="text-sm text-muted-foreground">
                  {request.departmentName ?? "Any department"} — Sent {new Date(request.createdAt).toLocaleDateString()}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ListPage>
  );
}
