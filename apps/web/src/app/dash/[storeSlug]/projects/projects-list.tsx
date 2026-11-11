"use client";

import { isTerminalProjectStatus, projectStatusLabel } from "@jendal-workspace/core";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Search } from "lucide-react";

import Loader from "@/components/loader";
import { ListPage } from "@/components/page-composition";
import { Badge } from "@jendal-workspace/ui/components/badge";
import { buttonVariants } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { trpc } from "@/utils/trpc";
import { TEAM_PROJECT_TONES } from "@/lib/status-labels";

import { TEAM_PROJECT_NEXT_STEP } from "./project-next-step";

const FILTERS = [
  ["open", "Open"],
  ["closed", "Closed"],
  ["all", "All"],
] as const;

export default function ProjectsList({ teamSlug }: { teamSlug: string }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("open");
  const [search, setSearch] = useState("");
  const projects = useQuery({ ...trpc.project.list.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });

  if (projects.isPending) return <Loader />;
  if (projects.isError) {
    return (
      <ListPage>
        <h1 className="font-heading text-3xl">Projects unavailable</h1>
        <p className="text-sm text-muted-foreground">{projects.error.message}</p>
        <button type="button" onClick={() => void projects.refetch()} className={buttonVariants({ variant: "outline" })}>Try again</button>
      </ListPage>
    );
  }

  const matching = projects.data.filter((project) => {
    const statusMatches = filter === "all" || (filter === "closed" ? isTerminalProjectStatus(project.status) : !isTerminalProjectStatus(project.status));
    return statusMatches && `${project.title} ${project.clientName ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  });

  // Whose move it is, over the rows in view (tab counts already give open/closed totals). Brand tone means the team acts.
  const yourMove = matching.filter((project) => TEAM_PROJECT_TONES[project.status] === "brand").length;
  const clientMove = matching.filter((project) => TEAM_PROJECT_NEXT_STEP[project.status] !== null && TEAM_PROJECT_TONES[project.status] !== "brand").length;

  return (
    <ListPage>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-heading text-3xl">Projects</h1>
          {yourMove + clientMove > 0 ? (
            <p className="text-sm text-muted-foreground">
              <span className="font-tabular font-medium text-foreground">{yourMove}</span> {yourMove === 1 ? "needs" : "need"} your move
              {" · "}
              <span className="font-tabular">{clientMove}</span> waiting on clients
            </p>
          ) : null}
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
          <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="relative w-full sm:max-w-64">
            <span className="sr-only">Search projects by title or client</span>
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" aria-hidden="true" />
            <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects…" className="pl-9" />
          </label>
          <div role="group" aria-label="Show" className="inline-flex w-fit rounded-[8px] border p-0.5">
            {FILTERS.map(([key, label]) => {
              const count = projects.data.filter((project) =>
                key === "all" ? true : key === "closed" ? isTerminalProjectStatus(project.status) : !isTerminalProjectStatus(project.status),
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
          </div>
          <p role="status" className="sr-only">{matching.length} projects shown</p>
          {matching.length === 0 ? (
            <div className="rounded-[10px] border px-5 py-10 text-center">
              <h2 className="font-heading text-lg">No matching projects</h2>
              <p className="mt-2 text-sm text-muted-foreground">Try another title, client or status.</p>
              <button type="button" onClick={() => { setSearch(""); setFilter("all"); }} className={buttonVariants({ variant: "outline", className: "mt-4" })}>Clear filters</button>
            </div>
          ) : (
          <ul className="panel divide-y overflow-hidden">
            {matching
              .map((project) => (
                <li key={project.id}>
                  <Link
                    href={`/${teamSlug}/projects/${project.id}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3.5 transition-colors hover:bg-accent/60 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)_auto]"
                  >
                    {/* Fixed identity column so next steps line up row to row from md up. */}
                    <div className="min-w-0">
                      <p className="truncate font-medium">{project.title}</p>
                      <p className="truncate text-sm text-muted-foreground">{project.clientName ?? "No client"}</p>
                    </div>
                    {TEAM_PROJECT_NEXT_STEP[project.status] ? (
                      <p className="col-start-1 row-start-2 min-w-0 truncate text-sm md:col-start-2 md:row-start-1">
                        {TEAM_PROJECT_NEXT_STEP[project.status]}
                      </p>
                    ) : null}
                    <Badge tone={TEAM_PROJECT_TONES[project.status]} className="col-start-2 row-start-1 justify-self-end md:col-start-3">
                      {projectStatusLabel(project.status)}
                    </Badge>
                  </Link>
                </li>
              ))}
          </ul>
          )}
        </>
      )}
    </ListPage>
  );
}
