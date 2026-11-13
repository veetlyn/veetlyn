import { cn } from "@jendal-workspace/ui/lib/utils";
import { type ReactNode, useId } from "react";

// A section of a record page (a project, an order, a payout): title and optional description, actions on the
// right, the body in the white card, and an optional footer strip for the form that adds to it. Record pages are
// built from these, so every record reads the same way.
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
    <section id={id} aria-labelledby={headingId} className={cn("frame frame-panel scroll-mt-4 min-w-0", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 px-3 pt-2.5 pb-2">
        <div className="min-w-0 space-y-0.5">
          <h2 id={headingId} className="text-sm font-medium">{title}</h2>
          {description ? <p className="text-[13px] text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      {children ? <div className={cn("frame frame-body min-w-0", flush ? undefined : "p-4")}>{children}</div> : null}
      {footer ? <div className={cn("px-3 pt-2.5 pb-3", children ? undefined : "frame frame-body p-4")}>{footer}</div> : null}
    </section>
  );
}
