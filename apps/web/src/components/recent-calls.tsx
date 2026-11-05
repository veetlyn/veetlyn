import Link from "next/link";

// The person's latest calls at this node, under the sidebar's pages.
export default function RecentCalls({ calls, callsPath, label = "Chats" }: { calls: { id: string; title: string }[]; callsPath: string; label?: string }) {
  if (calls.length === 0) return null;
  return (
    <section className="pt-4" aria-label={label}>
      <h2 className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">{label}</h2>
      <ul className="grid gap-0.5">
        {calls.map((call) => (
          <li key={call.id}>
            <Link
              href={`${callsPath}?call=${call.id}`}
              className="block truncate rounded-[6px] px-2.5 py-1.5 text-[14px] text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
            >
              {call.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
