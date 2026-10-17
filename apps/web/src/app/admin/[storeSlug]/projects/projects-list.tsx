"use client";

import { projectStatusLabel } from "@jendal-workspace/core";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import Loader from "@/components/loader";
import { buttonVariants } from "@jendal-workspace/ui/components/button";
import { trpc } from "@/utils/trpc";

export default function ProjectsList({ teamSlug }: { teamSlug: string }) {
  const projects = useQuery({ ...trpc.project.list.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });

  if (projects.isPending) return <Loader />;
  if (projects.isError) {
    return (
      <main className="container mx-auto max-w-4xl space-y-4 px-4 py-6">
        <h1 className="text-2xl font-semibold">Projects unavailable</h1>
        <p className="text-sm text-muted-foreground">{projects.error.message}</p>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-4xl space-y-6 px-4 py-6">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <Link href={`/${teamSlug}`} className="text-sm text-muted-foreground">
            Team dashboard
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
        </div>
        <Link href={`/${teamSlug}/projects/new`} className={buttonVariants()}>
          New project
        </Link>
      </div>
      {projects.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No projects yet. Start one for your next client.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {projects.data.map((project) => (
            <li key={project.id}>
              <Link href={`/${teamSlug}/projects/${project.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-muted/50">
                <div>
                  <p className="font-medium">{project.title}</p>
                  <p className="text-sm text-muted-foreground">{project.clientName ?? "No client"}</p>
                </div>
                <span className="text-sm text-muted-foreground">{projectStatusLabel(project.status)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
