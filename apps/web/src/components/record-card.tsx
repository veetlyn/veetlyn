import { cn } from "@jendal-workspace/ui/lib/utils";
import { type ReactNode, useId } from "react";

// A section of a record page (a project, an order, a payout): title and optional description, actions on the
// right, the body, and an optional footer for the form that adds to it. Record pages are built from these, so
// every record reads the same way.
export function RecordCard({
  title,
  description,
  actions,
  footer,
  children,
  id,
  className,
  flush,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  id?: string;
  className?: string;
  /** Rows that draw their own dividers sit edge to edge. */
  flush?: boolean;
}) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={headingId} className={cn("scroll-mt-4 overflow-hidden rounded-lg border bg-card", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0 space-y-0.5">
          <h2 id={headingId} className="font-heading text-base">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      {children ? <div className={flush ? "border-t" : "px-5 pb-5"}>{children}</div> : null}
      {footer ? <div className="border-t bg-background/50 px-5 py-4">{footer}</div> : null}
    </section>
  );
}
