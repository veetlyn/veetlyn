"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import Loader from "@/components/loader";
import { trpc } from "@/utils/trpc";

const HOUR_MS = 3_600_000;

// The response window is shown here only; the reminder and the expiry belong to the scheduled jobs.
function windowLabel(respondBy: Date, now: number): string {
  const hours = Math.ceil((respondBy.getTime() - now) / HOUR_MS);
  if (hours <= 0) return "Past the 48-hour window";
  return hours === 1 ? "1 hour left to answer" : `${hours} hours left to answer`;
}

export default function OpenRequests({ teamSlug }: { teamSlug: string }) {
  const requests = useQuery({ ...trpc.project.openRequests.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });

  if (requests.isPending) return <Loader />;
  if (requests.isError) {
    return (
      <main className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 md:px-7 md:py-8">
        <h1 className="font-heading text-3xl">Requests unavailable</h1>
        <p className="text-sm text-muted-foreground">{requests.error.message}</p>
      </main>
    );
  }

  const now = Date.now();
  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 md:px-7 md:py-8">
      <div className="space-y-1">
        <h1 className="font-heading text-3xl">Open requests</h1>
        <p className="text-sm text-muted-foreground">
          Requests you can answer: ask the client a question, send a quote, or leave it to the team.
        </p>
      </div>
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
                  <p className="shrink-0 text-sm text-muted-foreground">{windowLabel(new Date(request.respondBy), now)}</p>
                </div>
                <p className="line-clamp-2 text-sm text-muted-foreground">{request.brief}</p>
                <p className="text-sm text-muted-foreground">
                  {request.departmentName ?? "Any department"} · Sent {new Date(request.createdAt).toLocaleDateString()}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
