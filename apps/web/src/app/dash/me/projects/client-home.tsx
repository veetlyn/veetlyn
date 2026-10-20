"use client";

import { projectStatusLabel } from "@jendal-workspace/core";
import { Badge } from "@jendal-workspace/ui/components/badge";
import { useQuery } from "@tanstack/react-query";

import Loader from "@/components/loader";
import { CLIENT_PROJECT_TONES } from "@/lib/status-labels";
import { trpc } from "@/utils/trpc";

// The client's home (plugin design §7): the projects they asked for across teams, each opening that team's own
// client page. The web twin of the AI assistant's project list.
export default function ClientHome() {
  const projects = useQuery({ ...trpc.project.mine.queryOptions({}), retry: false, meta: { silent: true } });

  if (projects.isPending) return <Loader />;
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 md:px-7 md:py-8">
      <div className="space-y-1">
        <h1 className="font-heading text-3xl">Your projects</h1>
        <p className="text-sm text-muted-foreground">Work you asked teams for, from the web or your AI assistant.</p>
      </div>
      {projects.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {projects.error.message}
        </p>
      ) : projects.data.length === 0 ? (
        <div className="panel grid justify-items-center gap-2 p-10 text-center">
          <p className="font-heading text-lg">No projects yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Projects you request with this account's email show here, whichever team you asked.
          </p>
        </div>
      ) : (
        <ul className="panel divide-y overflow-hidden">
          {projects.data.map((project) => {
            const row = (
              <>
                <div className="min-w-0">
                  <p className="truncate font-medium">{project.title}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {project.teamName} · {new Date(project.createdAt).toLocaleDateString()}
                    {project.briefStart ? ` · ${project.briefStart}` : ""}
                  </p>
                </div>
                <Badge tone={CLIENT_PROJECT_TONES[project.status]}>{projectStatusLabel(project.status)}</Badge>
              </>
            );
            return (
              <li key={project.id}>
                {project.clientUrl ? (
                  <a
                    href={project.clientUrl}
                    className="flex items-center justify-between gap-4 px-4 py-3.5 transition-colors hover:bg-accent/60"
                  >
                    {row}
                  </a>
                ) : (
                  <div className="flex items-center justify-between gap-4 px-4 py-3.5">{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
