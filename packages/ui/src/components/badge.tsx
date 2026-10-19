import { cn } from "@jendal-workspace/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

// Kinds and states as words on a soft fill. Warm tones are for trouble only.
const badgeVariants = cva(
  "inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "bg-secondary text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]",
        brand: "bg-brand-wash text-brand-text",
        good: "bg-brand-wash text-brand-text",
        warn: "bg-warning/10 text-warning",
        fail: "bg-destructive/10 text-destructive",
        info: "bg-info-wash text-info",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

function Badge({ className, tone, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { Badge, badgeVariants };
