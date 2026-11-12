import Link from "next/link";

// The person's latest calls at this node, under the sidebar's pages.
export default function RecentCalls({ calls, callsPath, newThreadHref = callsPath, label = "Your threads" }: { calls: { id: string; title: string }[]; callsPath: string; newThreadHref?: string; label?: string }) {
  return (
    <section className="min-w-0 pt-6" aria-label={label}>
      <div className="flex items-center justify-between gap-2 px-2.5 pb-2 text-xs text-muted-foreground">
        <h2>{label}</h2>
        <Link href={newThreadHref} className="rounded px-1 py-1 hover:text-foreground">+ New</Link>
      </div>
      {calls.length === 0 ? <p className="px-2.5 py-2 text-xs text-muted-foreground">No threads yet</p> : null}
      <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5">
        {calls.map((call) => (
          <li key={call.id} className="min-w-0">
            <Link
              href={`${callsPath}?call=${call.id}`}
              className="block truncate rounded-[6px] px-2.5 py-1.5 text-[13px] font-medium text-foreground hover:bg-foreground/[0.04]"
            >
              {call.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
