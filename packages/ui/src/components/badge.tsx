import { cn } from "@jendal-workspace/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

// Kinds and states as coloured words. Warm tones are for trouble only. "brand" is the viewer's move and carries a mint
// wash so it stands apart from "good" (settled), which stays plain mint words; the dash adds a neutral tint behind
// every label (dash.css).
const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1 text-xs font-medium whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      tone: {
        neutral: "text-muted-foreground",
        brand: "rounded-[4px] bg-brand-wash px-1.5 py-px font-semibold text-brand-text",
        good: "font-medium text-brand-text",
        warn: "font-semibold text-warning",
        fail: "font-semibold text-destructive",
        info: "text-info",
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
