import { cn } from "@jendal-workspace/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

// Kinds and states as coloured words, no fill or outline. Warm tones are for trouble only.
const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 text-xs font-medium whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "text-muted-foreground",
        brand: "font-semibold text-brand-text",
        good: "font-semibold text-brand-text",
        warn: "font-semibold text-warning",
        fail: "font-semibold text-destructive",
        info: "text-info",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

function Badge({ className, tone, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { Badge, badgeVariants };
