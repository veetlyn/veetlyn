import Link from "next/link";

import { threadWhen } from "@/lib/thread-labels";

// The person's latest calls at this node, under the sidebar's pages.
export default function RecentCalls({ calls, callsPath, newThreadHref = callsPath, label = "Your threads" }: { calls: { id: string; title: string; openedAt: string | Date }[]; callsPath: string; newThreadHref?: string; label?: string }) {
  const when = threadWhen(calls);
  return (
    <section className="min-w-0 pt-6" aria-label={label}>
      <div className="flex items-center justify-between gap-2 px-2.5 pb-2 text-xs text-muted-foreground">
        <p aria-hidden="true">{label}</p>
        <Link href={newThreadHref} className="rounded px-1 py-1 hover:text-foreground">+ New</Link>
      </div>
      {calls.length === 0 ? <p className="px-2.5 py-2 text-xs text-muted-foreground">No threads yet</p> : null}
      <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5">
        {calls.map((call) => (
          <li key={call.id} className="min-w-0">
            <Link
              href={`${callsPath}?thread=${call.id}`}
              className="grid min-w-0 rounded-[8px] px-2.5 py-1.5 text-[13px] font-medium text-foreground hover:bg-foreground/[0.04]"
            >
              <span className="truncate">{call.title}</span>
              {/* A repeated name carries when it was opened on its own line, so the name keeps the full width. */}
              {when.has(call.id) ? <span className="text-[11px] leading-4 font-normal text-muted-foreground tabular-nums">{when.get(call.id)}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
