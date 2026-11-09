"use client";

import { projectStatusLabel } from "@jendal-workspace/core";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import Loader from "@/components/loader";
import { trpc } from "@/utils/trpc";

// Only what we can trace: requests sent from a client's assistant through the connector. Assistants don't report how
// often they showed a seller, so there is no such number here.
export default function FromAi({ teamSlug }: { teamSlug: string }) {
  const projects = useQuery({ ...trpc.project.list.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  if (projects.isPending) return <Loader />;
  const fromAi = (projects.data ?? []).filter((project) => project.clientHomeSurface === "mcp");
  const won = fromAi.filter((project) => !["quoting", "expired", "declined", "cancelled", "abandoned"].includes(project.status));
  const stats = [
    { label: "Requests from assistants", value: fromAi.length },
    { label: "Became projects", value: won.length },
  ];
  return (
    <main className="mx-auto grid w-full max-w-5xl gap-6 px-4 py-6 md:px-7 md:py-8">
      <div className="space-y-1">
        <h1 className="font-heading text-3xl">From AI</h1>
        <p className="text-sm text-muted-foreground">Clients who reached you through their assistant, and what came of it.</p>
      </div>
      <dl className="panel grid grid-cols-2 divide-x">
        {stats.map((stat) => (
          <div key={stat.label} className="grid gap-1 px-5 py-4">
            <dt className="text-[13px] text-muted-foreground">{stat.label}</dt>
            <dd className="font-heading text-2xl tabular-nums">{stat.value}</dd>
          </div>
        ))}
      </dl>
      {fromAi.length === 0 ? (
        <div className="panel grid justify-items-center gap-2 p-10 text-center">
          <p className="font-heading text-lg">No requests from assistants yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">When a client sends a request from Claude or ChatGPT, it shows here.</p>
        </div>
      ) : (
        <ul className="panel divide-y overflow-hidden">
          {fromAi.map((project) => (
            <li key={project.id}>
              <Link href={`/${teamSlug}/projects/${project.id}`} className="flex items-baseline justify-between gap-4 px-4 py-3.5 hover:bg-accent/60">
                <span className="truncate font-medium">{project.title}</span>
                <span className="shrink-0 text-sm text-muted-foreground">{projectStatusLabel(project.status)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted-foreground">We report what happened. We never promise rankings.</p>
    </main>
  );
}
