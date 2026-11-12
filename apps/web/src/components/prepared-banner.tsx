"use client";

import { buttonVariants } from "@jendal-workspace/ui/components/button";
import { cn } from "@jendal-workspace/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { AgentIcon } from "@/components/agent-icon";
import { trpc } from "@/utils/trpc";

// A project's waiting decision, where the person is already looking at the project.
export default function PreparedBanner({ teamId, projectId, slug }: { teamId: string; projectId: string; slug: string }) {
  const pending = useQuery({
    ...trpc.agent.pending.queryOptions({ node: { kind: "record", teamId, record: { type: "project", id: projectId } } }),
    enabled: teamId !== "",
    retry: false,
    meta: { silent: true },
  });
  const item = pending.data?.pending[0];
  if (!item) return null;
  return (
    <div className="panel flex items-center gap-3 px-4 py-3">
      <AgentIcon className="size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{item.card.title}, prepared and waiting for you</p>
        {item.note ? <p className="truncate text-[13px] text-muted-foreground">{item.note}</p> : null}
      </div>
      <Link href={`/${slug}/threads?thread=${item.callId}`} className={cn(buttonVariants({ variant: "mint", size: "sm" }), "px-4")}>
        Review
      </Link>
    </div>
  );
}
