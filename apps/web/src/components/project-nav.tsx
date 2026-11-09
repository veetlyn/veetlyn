"use client";

import { projectStatusLabel } from "@jendal-workspace/core";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@jendal-workspace/ui/components/dropdown-menu";
import { cn } from "@jendal-workspace/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronsUpDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useActiveSection } from "@/components/page-sections-nav";
import RecentCalls from "@/components/recent-calls";
import { trpc } from "@/utils/trpc";

// The project's own parts, in page order; only those the page shows are listed.
const PARTS = [
  { id: "request", label: "Request" },
  { id: "conversation", label: "Conversation" },
  { id: "clients", label: "Clients" },
  { id: "assignment", label: "Assignment" },
  { id: "quotes", label: "Quotes" },
  { id: "amendments", label: "Amendments" },
  { id: "deliveries", label: "Deliveries" },
  { id: "payments", label: "Payments" },
  { id: "refund", label: "Refund" },
  { id: "marks", label: "Member marks" },
] as const;

// The parts present on the page, rechecked as the page renders them.
function usePresentParts(): string[] {
  const [present, setPresent] = useState<string[]>([]);
  useEffect(() => {
    const read = () => {
      const ids = PARTS.map((part) => part.id).filter((id) => document.getElementById(id));
      setPresent((current) => (current.join() === ids.join() ? current : ids));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return present;
}

// The sidebar on a project (calls design §6): the second switcher names the project and jumps to another, then the
// way back to the projects, the project's parts and its calls with the assistant.
export default function ProjectNav({ slug, projectId, teamId }: { slug: string; projectId: string; teamId: string }) {
  const router = useRouter();
  const detail = useQuery({
    ...trpc.project.get.queryOptions({ teamSlug: slug, projectId }),
    retry: false,
    meta: { silent: true },
  });
  const projects = useQuery({
    ...trpc.project.list.queryOptions({ teamSlug: slug }),
    retry: false,
    meta: { silent: true },
  });
  const calls = useQuery({
    ...trpc.agent.calls.queryOptions({ node: { kind: "record", teamId, record: { type: "project", id: projectId } } }),
    enabled: teamId !== "",
    retry: false,
    meta: { silent: true },
  });
  const present = usePresentParts();
  const active = useActiveSection(present);
  const project = detail.data?.project;
  const others = (projects.data ?? []).filter((p) => p.id !== projectId).slice(0, 10);
  const noProjects = projects.isPending ? "Loading projects…" : projects.isError ? "Projects couldn’t be loaded." : "No other projects.";

  return (
    <>
      <details className="mb-2 min-w-0 rounded-lg border md:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
          <span className="grid min-w-0 flex-1">
            <span className="truncate text-sm font-semibold">{project?.title ?? "Project"}</span>
            <span className="text-xs text-muted-foreground">{project ? projectStatusLabel(project.status) : "Loading…"}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0" aria-hidden="true" />
          <span className="sr-only">Switch project</span>
        </summary>
        <nav aria-label="Switch project" className="grid max-h-64 min-w-0 gap-1 overflow-y-auto border-t p-1">
          {others.map((item) => <Link key={item.id} href={`/${slug}/projects/${item.id}`} className="grid min-w-0 gap-1 rounded-lg px-2 py-3 hover:bg-accent">
            <span className="truncate text-sm">{item.title}</span>
            <span className="text-xs text-muted-foreground">{projectStatusLabel(item.status)}</span>
          </Link>)}
          {others.length === 0 ? <p role="status" className="p-2 text-sm text-muted-foreground">{noProjects}</p> : null}
        </nav>
      </details>
      <div className="hidden md:block">
      <DropdownMenu>
        <DropdownMenuTrigger
          className="mb-1 flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left hover:bg-foreground/[0.04]"
          aria-label={project ? `${project.title}. Switch project` : "Switch project"}
        >
          <span className="grid size-6 shrink-0 place-items-center rounded-[6px] bg-card text-[12px] font-semibold uppercase shadow-[inset_0_0_0_1px_var(--border)]">
            {project?.title.slice(0, 1) ?? "?"}
          </span>
          <span className="grid min-w-0 flex-1">
            <b className="truncate text-[14px] font-semibold">{project?.title ?? "Project"}</b>
            <span className="truncate text-xs text-muted-foreground">
              {project ? projectStatusLabel(project.status) : "Loading"}
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 bg-card">
          <DropdownMenuLabel>Projects</DropdownMenuLabel>
          {others.length === 0 ? <p role="status" className="px-2 py-1.5 text-sm text-muted-foreground">{noProjects}</p> : null}
          {others.map((p) => (
            <DropdownMenuItem key={p.id} onClick={() => router.push(`/${slug}/projects/${p.id}`)}>
              <span className="grid min-w-0">
                <span className="truncate">{p.title}</span>
                <span className="truncate text-xs text-muted-foreground">{projectStatusLabel(p.status)}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      </div>
      <Link
        href={`/${slug}/projects`}
        className="flex items-center gap-2.5 rounded-[9px] px-2.5 py-[7px] text-sm font-medium text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to Projects
      </Link>
      <nav aria-label="This project" className="grid gap-0.5 pt-2">
        {PARTS.filter((part) => present.includes(part.id)).map((part) => (
          <a
            key={part.id}
            href={`#${part.id}`}
            aria-current={active === part.id ? "location" : undefined}
            onClick={(event) => {
              event.preventDefault();
              document.getElementById(part.id)?.scrollIntoView({ block: "start" });
              history.replaceState(null, "", `#${part.id}`);
            }}
            className={cn(
              "rounded-[9px] px-2.5 py-[7px] text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
              active === part.id ? "raised text-foreground" : "hover:bg-foreground/[0.04]",
            )}
          >
            {part.label}
          </a>
        ))}
      </nav>
      <RecentCalls calls={(calls.data?.calls ?? []).slice(0, 15)} callsPath={`/${slug}/calls`} newThreadHref={`/${slug}/calls?project=${projectId}`} label="Threads on this project" />
    </>
  );
}
