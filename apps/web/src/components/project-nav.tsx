"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Columns2, FileText, MessageCircle, Package, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { navItemClass } from "@/components/app-frame";
import RecentCalls from "@/components/recent-calls";
import { isProjectReadDenied } from "@/lib/project-refresh";
import { PROJECT_TABS } from "@/lib/project-tabs";
import { trpc } from "@/utils/trpc";

const ICONS = { overview: Columns2, quote: FileText, delivery: Package, conversation: MessageCircle, money: Wallet, activity: Users };

export default function ProjectNav({
  slug,
  projectId,
  teamId,
  backHref,
  backLabel,
  agentAvailable,
}: {
  slug: string;
  projectId: string;
  teamId: string;
  backHref: string;
  backLabel: string;
  agentAvailable: boolean;
}) {
  const pathname = usePathname();
  const base = `/${slug}/projects/${projectId}`;
  const detail = useQuery({ ...trpc.project.get.queryOptions({ teamSlug: slug, projectId }), retry: false, meta: { silent: true } });
  const calls = useQuery({
    ...trpc.agent.calls.queryOptions({ node: { kind: "record", teamId, record: { type: "project", id: projectId } } }),
    enabled: teamId !== "" && agentAvailable,
    retry: false,
    meta: { silent: true },
  });
  const readable = !isProjectReadDenied(detail.error);
  const project = readable ? detail.data?.project : undefined;
  const tabs = PROJECT_TABS.filter((tab) => !(detail.data?.financesHidden && (tab.key === "quote" || tab.key === "money")));

  return <>
    <div className="mb-3 grid min-w-0 gap-4 border-b pb-3">
      <Link href={backHref} className={navItemClass(false)}>
        <ArrowLeft className="size-4 shrink-0" aria-hidden="true" />Back to {backLabel}
      </Link>
      <p className="break-words px-2.5 text-sm font-semibold">{project?.title ?? (detail.isError ? "Project unavailable" : "Loading project…")}</p>
    </div>
    <nav aria-label="Project" className="grid gap-0.5">
      {tabs.map((tab) => {
        const href = tab.key === "overview" ? base : `${base}/${tab.key}`;
        const current = pathname === href || (tab.key === "overview" && pathname === `${base}/overview`);
        const Icon = ICONS[tab.key];
        return <Link key={tab.key} href={href} aria-current={current ? "page" : undefined} className={navItemClass(current)}>
          <Icon className="size-4 shrink-0" aria-hidden="true" />{tab.label}
        </Link>;
      })}
    </nav>
    {agentAvailable ? <RecentCalls calls={(calls.data?.calls ?? []).slice(0, 15)} callsPath={`/${slug}/threads`} newThreadHref={`/${slug}/threads?project=${projectId}`} /> : null}
  </>;
}
