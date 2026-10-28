"use client";

import { projectStatusLabel } from "@jendal-workspace/core";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import Loader from "@/components/loader";
import { Badge } from "@jendal-workspace/ui/components/badge";
import { buttonVariants } from "@jendal-workspace/ui/components/button";
import { trpc } from "@/utils/trpc";
import { TEAM_PROJECT_TONES } from "@/lib/status-labels";

const CLOSED = new Set(["completed", "cancelled", "declined", "expired"]);
const FILTERS = [
  ["open", "Open"],
  ["closed", "Closed"],
  ["all", "All"],
] as const;

export default function ProjectsList({ teamSlug }: { teamSlug: string }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("open");
  const projects = useQuery({ ...trpc.project.list.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });

  if (projects.isPending) return <Loader />;
  if (projects.isError) {
    return (
      <main className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6 md:px-7 md:py-8">
        <h1 className="font-heading text-3xl">Projects unavailable</h1>
        <p className="text-sm text-muted-foreground">{projects.error.message}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 md:px-7 md:py-8">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-heading text-3xl">Projects</h1>
        </div>
        <Link href={`/${teamSlug}/projects/new`} className={buttonVariants()}>
          New project
        </Link>
      </div>
      {projects.data.length === 0 ? (
        <div className="panel grid justify-items-center gap-2 p-10 text-center">
          <p className="font-heading text-lg">No projects yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Requests from your seller page become projects here, or start one for a client yourself.
          </p>
        </div>
      ) : (
        <>
          <div role="group" aria-label="Show" className="inline-flex w-fit rounded-[10px] bg-tray p-0.5 well">
            {FILTERS.map(([key, label]) => {
              const count = projects.data.filter((project) =>
                key === "all" ? true : key === "closed" ? CLOSED.has(project.status) : !CLOSED.has(project.status),
              ).length;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={filter === key}
                  onClick={() => setFilter(key)}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-[0_0_0_1px_var(--input)]"
                >
                  {label} <span className="font-tabular text-xs text-muted-foreground">{count}</span>
                </button>
              );
            })}
          </div>
          <ul className="panel divide-y overflow-hidden">
            {projects.data
              .filter((project) =>
                filter === "all" ? true : filter === "closed" ? CLOSED.has(project.status) : !CLOSED.has(project.status),
              )
              .map((project) => (
                <li key={project.id}>
                  <Link
                    href={`/${teamSlug}/projects/${project.id}`}
                    className="flex items-center justify-between gap-4 px-4 py-3.5 transition-colors hover:bg-accent/60"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{project.title}</p>
                      <p className="truncate text-sm text-muted-foreground">{project.clientName ?? "No client"}</p>
                    </div>
                    <Badge tone={TEAM_PROJECT_TONES[project.status]}>
                      {projectStatusLabel(project.status)}
                    </Badge>
                  </Link>
                </li>
              ))}
          </ul>
        </>
      )}
    </main>
  );
}
