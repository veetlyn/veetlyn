import "react";

// Inline styles may set CSS custom properties (`--i`, `--tab-x`) that stylesheets read.
declare module "react" {
  interface CSSProperties {
    [property: `--${string}`]: string | number | undefined;
  }
}
