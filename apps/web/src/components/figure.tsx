import { cn } from "@jendal-workspace/ui/lib/utils";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

// Figures sit on the surface, never in a box: a quiet label, the number, one line of context. A linked figure opens
// the records behind it.
export function Figure({ label, value, note, href }: { label: string; value: string; note: string; href?: string }) {
  const content = (
    <>
      <p className="flex items-center gap-1 text-[13px] text-muted-foreground">
        {label}
        {href ? <ChevronRight aria-hidden="true" className="size-3.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100" /> : null}
      </p>
      <p className="mt-1.5 font-tabular text-[24px] leading-tight font-medium tracking-[-0.02em]">{value}</p>
      <p className="mt-1 text-[12px] text-muted-foreground">{note}</p>
    </>
  );
  return href ? (
    <Link href={href} className="group block min-w-0 rounded-[8px] outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">{content}</Link>
  ) : (
    <div className="min-w-0">{content}</div>
  );
}

// Several figures side by side, split by hairlines, between two rules; on a phone they stack.
export function StatRow({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <section
      aria-label={label}
      className={cn(
        "grid grid-cols-1 gap-5 border-y py-5 sm:auto-cols-fr sm:grid-flow-col sm:gap-0 sm:divide-x [&>*]:sm:px-6 [&>*:first-child]:sm:pl-0 [&>*:last-child]:sm:pr-0",
        className,
      )}
    >
      {children}
    </section>
  );
}
