import type { ProductProblem } from "@jendal-workspace/core";

export class CatalogValidationError extends Error {
  constructor(readonly problems: ProductProblem[]) {
    super(problems[0]?.message ?? "Check the product details.");
    this.name = "CatalogValidationError";
  }
}
