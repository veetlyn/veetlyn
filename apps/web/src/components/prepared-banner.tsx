"use client";

import { buttonVariants } from "@jendal-workspace/ui/components/button";
import { cn } from "@jendal-workspace/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { AgentIcon } from "@/components/agent-icon";
import { usePlatformName } from "@/components/platform-name";
import { preparedRow } from "@/lib/prepared-row";
import { trpc } from "@/utils/trpc";

// A project's waiting decision, where the person is already looking at the project: what was prepared, its price and
// the review it opens. The project is the page, so it isn't repeated; the rationale stays in the thread.
export default function PreparedBanner({ teamId, projectId, slug }: { teamId: string; projectId: string; slug: string }) {
  const platform = usePlatformName();
  const pending = useQuery({
    ...trpc.agent.pending.queryOptions({ node: { kind: "record", teamId, record: { type: "project", id: projectId } } }),
    enabled: teamId !== "",
    retry: false,
    meta: { silent: true },
  });
  const item = pending.data?.pending[0];
  if (!item) return null;
  const row = preparedRow(item.card, null);
  // Every other kind's title is the project or its client, which this page already shows.
  const what = item.card.kind === "payout" ? `${row.title} · ${row.detail}` : row.detail;
  return (
    <div className="panel flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <AgentIcon className="size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="break-words text-[14px] font-medium">{what}</p>
        <p className="text-[13px] text-muted-foreground">Prepared by {platform}, waiting for you</p>
      </div>
      {row.amount ? <span className="font-tabular font-semibold whitespace-nowrap">{row.amount}</span> : null}
      <Link href={`/${slug}/calls?call=${item.callId}`} className={cn(buttonVariants({ variant: "mint", size: "sm" }), "px-4")}>
        {row.action}
      </Link>
    </div>
  );
}
