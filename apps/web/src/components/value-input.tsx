import { Input } from "@jendal-workspace/ui/components/input";
import { cn } from "@jendal-workspace/ui/lib/utils";
import * as React from "react";

// Keep decimal text intact for the domain parser (including comma percentages).
// Units are presentation and accessible description, never part of the stored value.
export function ValueInput({ unit, unitLabel = unit, className, id, inputMode = "decimal", "aria-describedby": describedBy, ...props }: React.ComponentProps<typeof Input> & {
  unit: string;
  unitLabel?: string;
}) {
  const generatedId = React.useId();
  const unitId = `${id ?? generatedId}-unit`;
  return (
    <div className={cn("relative max-w-full", unit === "%" ? "w-28" : unit === "days" || unit === "units" ? "w-32" : "w-44")}>
      <Input
        {...props}
        id={id}
        inputMode={inputMode}
        aria-describedby={[describedBy, unitId].filter(Boolean).join(" ")}
        className={cn("pr-14 text-base tabular-nums md:text-sm", className)}
      />
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">{unit}</span>
      <span id={unitId} className="sr-only">{unitLabel}</span>
    </div>
  );
}
