"use client";

import { isTerminalProjectStatus, projectStatusLabel } from "@jendal-workspace/core";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Search } from "lucide-react";

import Loader from "@/components/loader";
import { ListPage, SummaryStrip } from "@/components/page-composition";
import { Badge } from "@jendal-workspace/ui/components/badge";
import { buttonVariants } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@jendal-workspace/ui/components/motion/tabs";
import { trpc } from "@/utils/trpc";
import { TEAM_PROJECT_TONES } from "@/lib/status-labels";

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

  return (
    <ListPage>
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-heading text-3xl">Projects</h1>
        </div>
        <Link href={`/${teamSlug}/projects/new`} className={buttonVariants()}>
          New project
        </Link>
      </div>
      {projects.data.length > 0 ? (
        <SummaryStrip label="Needs attention">
          <p className="text-sm"><span className="font-medium">{projects.data.filter((project) => !isTerminalProjectStatus(project.status)).length} open projects</span> <span className="text-muted-foreground">in progress or waiting</span></p>
          <p className="text-sm text-muted-foreground">{matching.length} shown</p>
        </SummaryStrip>
      ) : null}
      {projects.data.length === 0 ? (
        <div className="panel grid justify-items-center gap-2 p-10 text-center">
          <p className="font-heading text-lg">No projects yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Requests from your seller page become projects here, or start one for a client yourself.
          </p>
        </div>
      ) : (
        <Tabs value={filter} onValueChange={(value) => setFilter(FILTERS.find(([key]) => key === value)?.[0] ?? "open")} variant="segment" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="relative w-full sm:max-w-64">
            <span className="sr-only">Search projects by title or client</span>
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" aria-hidden="true" />
            <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects…" className="pl-9" />
          </label>
          {/* beUI segmented tabs: one shared panel below, so search and the empty state keep working. */}
          <TabsList aria-label="Show projects" wrapperClassName="w-fit" className="border">
            {FILTERS.map(([key, label]) => {
              const count = projects.data.filter((project) =>
                key === "all" ? true : key === "closed" ? isTerminalProjectStatus(project.status) : !isTerminalProjectStatus(project.status),
              ).length;
              return (
                <TabsTrigger key={key} value={key} className="gap-1.5">
                  {label} <span className="font-tabular text-xs opacity-70">{count}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>
          </div>
          <TabsContent value={filter} className="mt-0 rounded-[10px]">
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
          )}
          </TabsContent>
        </Tabs>
      )}
    </ListPage>
  );
}
