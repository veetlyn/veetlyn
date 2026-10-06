import type { VariantOption } from "@jendal-workspace/core";

export function variantLabel(options: readonly VariantOption[]): string {
  if (options.length === 0) return "Default";
  return options.map((option) => `${option.name}: ${option.value}`).join(" / ");
}
