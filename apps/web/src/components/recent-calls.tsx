import Link from "next/link";

// Enough to resume recent work without the list taking over the sidebar.
export const RECENT_SHOWN = 5;

function CallLink({ call, callsPath }: { call: { id: string; title: string }; callsPath: string }) {
  return (
    <li className="min-w-0">
      {/* Two lines rather than one ellipsis: generated titles share a prefix and differ at the end. */}
      <Link
        href={`${callsPath}?call=${call.id}`}
        title={call.title}
        className="line-clamp-2 rounded-[6px] px-2.5 py-1.5 text-[14px] leading-5 font-medium break-words text-foreground hover:bg-foreground/[0.04]"
      >
        {call.title}
      </Link>
    </li>
  );
}

// The person's latest calls at this node, under the sidebar's pages. There is no thread list page, so older threads
// stay reachable behind a disclosure instead of a View all link.
export default function RecentCalls({ calls, callsPath, newThreadHref = callsPath, label = "Your threads" }: { calls: { id: string; title: string }[]; callsPath: string; newThreadHref?: string; label?: string }) {
  const shown = calls.slice(0, RECENT_SHOWN);
  const more = calls.slice(RECENT_SHOWN);
  return (
    <section className="min-w-0 pt-6" aria-label={label}>
      <div className="flex items-center justify-between gap-2 px-2.5 pb-2 text-xs text-muted-foreground">
        <h2>{label}</h2>
        <Link href={newThreadHref} className="rounded px-1 py-1 hover:text-foreground">+ New</Link>
      </div>
      {calls.length === 0 ? <p className="px-2.5 py-2 text-xs text-muted-foreground">No threads yet</p> : null}
      <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5">
        {shown.map((call) => <CallLink key={call.id} call={call} callsPath={callsPath} />)}
      </ul>
      {more.length > 0 ? (
        <details className="mt-0.5 min-w-0">
          <summary className="cursor-pointer rounded-[6px] px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">
            {more.length} older {more.length === 1 ? "thread" : "threads"}
          </summary>
          <ul className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-0.5">
            {more.map((call) => <CallLink key={call.id} call={call} callsPath={callsPath} />)}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
