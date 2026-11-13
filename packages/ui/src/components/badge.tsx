import { cn } from "@jendal-workspace/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

// Kinds and states as badges: a light tint of the tone behind a word in that tone. Warm tones are for trouble only;
// mint marks the viewer's move ("brand") and settled work ("good").
const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "bg-foreground/[0.06] text-foreground/75",
        brand: "bg-brand-wash text-brand-text",
        good: "bg-brand-wash text-brand-text",
        warn: "bg-warning/12 text-warning",
        fail: "bg-destructive/10 text-destructive",
        info: "bg-info-wash text-info",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

function Badge({ className, tone, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span data-slot="badge" data-tone={tone ?? "neutral"} className={cn(badgeVariants({ tone }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
