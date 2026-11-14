"use client";

import { cn } from "@jendal-workspace/ui/lib/utils";
import { ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { threadWhen } from "@/lib/thread-labels";

type Thread = { id: string; title: string; openedAt: string | Date; status?: "open" | "done" };

function ThreadLink({ thread, href, when, current }: { thread: Thread; href: string; when?: string; current: boolean }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      // A repeated name is told apart by when it was opened, shown on hover.
      title={when ? `${thread.title} · ${when}` : thread.title}
      className={cn(
        "flex min-w-0 rounded-[8px] px-3 py-1.5 transition-colors duration-150",
        current ? "selected-fill" : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
      )}
    >
      <span className="min-w-0 flex-1 truncate text-[14px]">{thread.title}</span>
    </Link>
  );
}

// The person's threads at this place, under the sidebar's places: open ones first, finished ones folded below.
export default function RecentCalls({ calls, callsPath, newThreadHref = callsPath, label = "Threads" }: { calls: Thread[]; callsPath: string; newThreadHref?: string; label?: string }) {
  const params = useSearchParams();
  const currentId = params.get("thread");
  const [showDone, setShowDone] = useState(false);
  const when = threadWhen(calls);
  const open = calls.filter((call) => call.status !== "done").slice(0, 8);
  const done = calls.filter((call) => call.status === "done");

  return (
    <section className="min-w-0 pt-7" aria-label={label}>
      <div className="flex items-center justify-between gap-2 px-3 pb-1.5">
        <Link href={callsPath} className="text-[13px] text-muted-foreground transition-colors duration-150 hover:text-foreground">{label}</Link>
        <Link href={newThreadHref} aria-label="New thread" className="grid size-6 place-items-center rounded-[6px] text-muted-foreground transition-colors duration-150 hover:bg-foreground/[0.05] hover:text-foreground">
          <Plus className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
      {calls.length === 0 ? <p className="px-3 py-1.5 text-[13px] text-muted-foreground">No threads yet</p> : null}
      <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-px">
        {open.map((thread) => (
          <li key={thread.id} className="min-w-0">
            <ThreadLink thread={thread} href={`${callsPath}?thread=${thread.id}`} when={when.get(thread.id)} current={thread.id === currentId} />
          </li>
        ))}
      </ul>
      {done.length > 0 ? (
        <div className="mt-1">
          <button
            type="button"
            aria-expanded={showDone}
            onClick={() => setShowDone((value) => !value)}
            className="flex w-full items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[13px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
          >
            <ChevronRight aria-hidden="true" className={cn("size-3.5 transition-transform duration-150", showDone && "rotate-90")} />
            Done
            <span className="ml-auto tabular-nums">{done.length}</span>
          </button>
          {showDone ? (
            <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-px">
              {done.slice(0, 8).map((thread) => (
                <li key={thread.id} className="min-w-0">
                  <ThreadLink thread={thread} href={`${callsPath}?thread=${thread.id}`} when={when.get(thread.id)} current={thread.id === currentId} />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
