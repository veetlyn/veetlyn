import { cva } from "class-variance-authority";

// Kept apart from button.tsx so server components can style links without loading Base UI.
export const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[9px] border border-transparent bg-clip-padding text-sm font-semibold font-[family-name:var(--font-num)] whitespace-nowrap transition-[background,box-shadow,color,transform] outline-none select-none active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "main-surface hover:brightness-110",
        outline: "raised text-foreground hover:brightness-[0.98] aria-expanded:brightness-[0.97]",
        secondary: "raised text-foreground hover:brightness-[0.98]",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground aria-expanded:bg-accent",
        destructive: "bg-destructive/10 text-destructive hover:bg-destructive/15 shadow-[inset_0_0_0_1px] shadow-destructive/25",
        link: "font-sans font-medium text-foreground underline underline-offset-4 decoration-border hover:decoration-foreground",
      },
      size: {
        default: "h-9 gap-2 px-3.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-7 gap-1 rounded-[7px] px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-[8px] px-3 text-[13px] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 rounded-[11px] px-5 text-[15px]",
        icon: "size-9",
        "icon-xs": "size-7 rounded-[7px] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-[8px]",
        "icon-lg": "size-11 rounded-[11px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);
