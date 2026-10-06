"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { buttonVariants } from "@jendal-workspace/ui/lib/button-variants";
import { cn } from "@jendal-workspace/ui/lib/utils";
import type { VariantProps } from "class-variance-authority";

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
