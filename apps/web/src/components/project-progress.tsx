import { cn } from "@jendal-workspace/ui/lib/utils";

const PROGRESS = [
  ["quoting", "Quote"],
  ["awaiting_deposit", "Deposit"],
  ["in_progress", "Work"],
  ["delivered", "Review"],
  ["awaiting_balance", "Balance"],
  ["completed", "Done"],
] as const;

// Where a project stands, from the quote to the last payment: a column on the team page, a row on the client page.
// A project paid in full up front has no balance step.
export function ProjectProgress({
  status,
  layout = "column",
  paidUpfront = false,
}: {
  status: string;
  layout?: "column" | "row";
  paidUpfront?: boolean;
}) {
  const steps = paidUpfront ? PROGRESS.filter(([key]) => key !== "awaiting_balance") : PROGRESS;
  const at = steps.findIndex(([key]) => key === status);
  if (at < 0) return null;
  const done = status === "completed";
  return (
    <section aria-label="Progress" className="panel p-4">
      <ol
        className={layout === "row" ? "grid gap-1.5" : "grid gap-2.5"}
        style={layout === "row" ? { gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` } : undefined}
      >
        {steps.map(([key, label], index) => {
          const state = index < at || done ? "done" : index === at ? "now" : "next";
          return (
            <li
              key={key}
              aria-current={state === "now" ? "step" : undefined}
              className={layout === "row" ? "grid gap-1.5 text-xs" : "flex items-center gap-2.5 text-sm"}
            >
              <span
                aria-hidden="true"
                className={
                  layout === "row"
                    ? state === "done"
                      ? "h-1.5 rounded-full bg-brand"
                      : state === "now"
                        ? "h-1.5 rounded-full bg-brand/45"
                        : "h-1.5 rounded-full bg-border"
                    : state === "done"
                      ? "size-3 rounded-[4px] bg-brand"
                      : state === "now"
                        ? "size-3 rounded-[4px] shadow-[inset_0_0_0_2px_var(--brand),0_0_0_3px_var(--brand-wash)]"
                        : "size-3 rounded-[4px] shadow-[inset_0_0_0_1.5px_var(--input)]"
                }
              />
              <span className={cn("truncate", state === "now" ? "font-semibold" : "text-muted-foreground")}>{label}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
