import Link from "next/link";

// The person's latest calls at this node, under the sidebar's pages.
export default function RecentCalls({ calls, callsPath, label = "Calls" }: { calls: { id: string; title: string }[]; callsPath: string; label?: string }) {
  if (calls.length === 0) return null;
  return (
    <div className="pt-4">
      <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <ul className="grid gap-0.5">
        {calls.map((c) => (
          <li key={c.id}>
            <Link
              href={`${callsPath}?call=${c.id}`}
              className="block truncate rounded-[9px] px-2.5 py-1.5 text-[13px] text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
            >
              {c.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
