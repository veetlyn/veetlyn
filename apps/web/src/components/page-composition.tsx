import { cn } from "@jendal-workspace/ui/lib/utils";

// The dash's page composition contract. Every page is one of three kinds; pages stop choosing their own widths. Work
// pages keep a 768px column and no side rail: facts about the record sit under its title, not in a column beside it.
// Document pages take a wider column for ordered financial lines. List pages use the table width.

export function WorkPage({
  composer,
  children,
  className,
}: {
  // Rendered at the foot of the work column, so a composer aligns with the content above it.
  composer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main data-composition="work" className={cn("mx-auto w-full min-w-0 max-w-[832px] px-4 py-6 text-sm md:px-7 md:py-8", className)}>
      <div data-work-column className="flex w-full min-w-0 flex-col">
        <div className="min-w-0 flex-1 space-y-6">{children}</div>
        {composer ? (
          <div data-composer-slot className="shrink-0 pt-4">
            {composer}
          </div>
        ) : null}
      </div>
    </main>
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

// Lists and tables: a PageHeader, then the list's views, search and rows.
export function ListPage({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <main data-composition="list" className={cn("mx-auto w-full min-w-0 max-w-[1200px] space-y-5 px-4 py-6 text-sm md:px-7 md:py-7", className)}>
      {children}
    </main>
  );
}

// The page's name and one plain line about it, with the page's own actions at the right of the title. The one
// action the page exists for is the mint key; the others are raised grey keys.
export function PageHeader({ title, description, actions }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header data-page-header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-2xl space-y-1">
        <h1 className="font-heading text-[24px] leading-[1.2]">{title}</h1>
        {description ? <p className="text-[13px] leading-5 text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
