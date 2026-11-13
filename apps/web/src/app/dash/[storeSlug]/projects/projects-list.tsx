"use client";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import { isTerminalProjectStatus, projectStatusLabel } from "@jendal-workspace/core";
import { Badge } from "@jendal-workspace/ui/components/badge";
import { buttonVariants } from "@jendal-workspace/ui/components/button";
import type { TableColumn } from "@jendal-workspace/ui/components/motion/table";
import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import Link from "next/link";

import { DataList } from "@/components/data-list";
import Loader from "@/components/loader";
import { ListPage, SummaryStrip } from "@/components/page-composition";
import { TEAM_PROJECT_TONES } from "@/lib/status-labels";
import { trpc } from "@/utils/trpc";

type Project = inferRouterOutputs<AppRouter>["project"]["list"][number];

const DATE: Intl.DateTimeFormatOptions = { dateStyle: "medium" };

function columns(teamSlug: string): TableColumn<Project>[] {
  return [
    {
      key: "title",
      header: "Project",
      sortable: true,
      sortValue: (p) => p.title.toLocaleLowerCase(),
      cell: (p) => <Link href={`/${teamSlug}/projects/${p.id}`} className="truncate font-medium underline-offset-4 hover:underline">{p.title}</Link>,
    },
    { key: "client", header: "Client", width: "220px", sortable: true, sortValue: (p) => p.clientName ?? "", cell: (p) => <span className="truncate text-muted-foreground">{p.clientName === "Client" ? "Name hidden until a quote is accepted" : (p.clientName ?? "No client")}</span> },
    { key: "status", header: "Status", width: "180px", sortable: true, sortValue: (p) => projectStatusLabel(p.status), cell: (p) => <Badge tone={TEAM_PROJECT_TONES[p.status]}>{projectStatusLabel(p.status)}</Badge> },
    { key: "created", header: "Created", width: "140px", sortable: true, sortValue: (p) => new Date(p.createdAt).getTime(), cell: (p) => <span className="whitespace-nowrap">{new Date(p.createdAt).toLocaleDateString(undefined, DATE)}</span> },
  ];
}

export default function ProjectsList({ teamSlug }: { teamSlug: string }) {
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

  const open = projects.data.filter((project) => !isTerminalProjectStatus(project.status)).length;
  const statuses = [...new Set(projects.data.map((project) => project.status))];

  return (
    <ListPage>
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-3xl">Projects</h1>
        <Link href={`/${teamSlug}/projects/new`} className={buttonVariants()}>New project</Link>
      </div>
      {projects.data.length > 0 ? (
        <SummaryStrip label="Needs attention">
          <p className="text-sm"><span className="font-medium">{open} open {open === 1 ? "project" : "projects"}</span> <span className="text-muted-foreground">in progress or waiting</span></p>
          <p className="text-sm text-muted-foreground">{projects.data.length - open} closed</p>
        </SummaryStrip>
      ) : null}
      <DataList
        label="Projects"
        rows={projects.data}
        columns={columns(teamSlug)}
        getRowId={(project) => project.id}
        searchText={(project) => `${project.title} ${project.clientName ?? ""}`}
        searchLabel="Search projects"
        filters={[
          {
            key: "state",
            label: "Projects",
            options: [{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }],
            match: (project, value) => (value === "closed") === isTerminalProjectStatus(project.status),
          },
          {
            key: "status",
            label: "Statuses",
            options: statuses.map((status) => ({ value: status, label: projectStatusLabel(status) })),
            match: (project, value) => project.status === value,
          },
        ]}
        defaultFilters={{ state: "open" }}
        defaultSort={{ key: "created", direction: "desc" }}
        empty={{ title: "No projects yet", text: "Requests from your seller page become projects here, or start one for a client yourself." }}
        noun={{ one: "project", many: "projects" }}
      />
    </ListPage>
  );
}
