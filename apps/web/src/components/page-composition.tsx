import { cn } from "@jendal-workspace/ui/lib/utils";

// The dash's page composition contract (design: page composition and agent harness). Every page is one of three
// kinds; pages stop choosing their own widths. Work pages keep a 720–768px column, an optional 240–280px context
// rail, and leave the rest of the canvas empty at the far right. Document pages take a wider column for ordered
// financial lines. List pages may use the table width, led by a summary strip.

export function WorkPage({
  rail,
  composer,
  children,
  className,
}: {
  rail?: React.ReactNode;
  // Rendered at the foot of the work column, so a composer aligns with the content above it.
  composer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main
      data-composition="work"
      className={cn(
        "mx-auto grid w-full min-w-0 max-w-[1104px] grid-cols-[minmax(0,1fr)] gap-x-10 gap-y-8 px-4 py-6 text-sm md:px-7 md:py-8",
        rail && "xl:grid-cols-[minmax(0,768px)_256px] xl:items-start",
        className,
      )}
    >
      <div data-work-column className={cn("mx-auto flex w-full min-w-0 max-w-[768px] flex-col", !rail && "xl:mx-auto", rail && "xl:mx-0")}>
        <div className="min-w-0 flex-1 space-y-6">{children}</div>
        {composer ? (
          <div data-composer-slot className="shrink-0 pt-4">
            {composer}
          </div>
        ) : null}
      </div>
      {rail}
    </main>
  );
}

// Context beside the work, never a repeat of the page header: status facts and the next action for this tab.
export function ContextRail({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <aside aria-label={label} className={cn("grid min-w-0 content-start gap-8 xl:sticky xl:top-6", className)}>
      {children}
    </aside>
  );
}

// Money and other documents: a wider column with room for a document header and ordered lines.
export function DocumentPage({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <main data-composition="document" className={cn("mx-auto w-full min-w-0 max-w-[896px] space-y-6 px-4 py-6 text-sm md:px-7 md:py-8", className)}>
      {children}
    </main>
  );
}

// Lists and tables: the page leads with a SummaryStrip, then the rows.
export function ListPage({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <main data-composition="list" className={cn("mx-auto w-full min-w-0 max-w-[1200px] space-y-6 px-4 py-6 text-sm md:px-7 md:py-8", className)}>
      {children}
    </main>
  );
}

// What needs the person on a list page, before the rows: counts, totals and the next item.
export function SummaryStrip({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <section role="region" aria-label={label} className={cn("flex flex-wrap items-center justify-between gap-3 rounded-[10px] border px-5 py-4", className)}>
      {children}
    </section>
  );
}
