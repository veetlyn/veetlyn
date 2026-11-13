import { cn } from "@jendal-workspace/ui/lib/utils";
import type { ReactNode } from "react";

// A coated frame: the shell's head strip carries the title, a count and one control; the white card holds the
// content; the foot strip carries totals or a link. Lists, stats and notices are built from it, so every block on a
// work screen has the same edge.
export function Frame({
  title,
  head,
  icon,
  count,
  actions,
  footer,
  children,
  className,
  bodyClassName,
  label,
  as: Tag = "section",
}: {
  title?: ReactNode;
  /** Controls that lead the head strip in place of a title (search, filters). */
  head?: ReactNode;
  icon?: ReactNode;
  count?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Names the frame when it has no title. */
  label?: string;
  as?: "section" | "div";
}) {
  const hasHead = title != null || head != null || actions != null;
  return (
    <Tag aria-label={label} className={cn("frame frame-panel min-w-0", className)}>
      {hasHead ? (
        <div className="frame-head">
          {icon ? <span aria-hidden="true" className="text-muted-foreground [&_svg]:size-[15px]">{icon}</span> : null}
          {title != null ? <h2 className="min-w-0 text-[13px] font-medium text-foreground/85">{title}</h2> : null}
          {head}
          {count != null ? <span className="text-[13px] text-muted-foreground tabular-nums">{count}</span> : null}
          {actions ? <div className="ml-auto flex min-w-0 flex-wrap items-center gap-1.5">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn("frame frame-body min-w-0", bodyClassName)}>{children}</div>
      {footer ? <div className="frame-foot">{footer}</div> : null}
    </Tag>
  );
}
