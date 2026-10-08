import { describe, expect, it } from "vitest";

import { publishProblem } from "./publish";

const ready = { product: "services" as const, status: "draft" as const, paypalMerchantId: "M1", listedCount: 1 };

describe("publishProblem", () => {
  it("lets a seller with PayPal and something to sell publish", () => {
    expect(publishProblem(ready)).toBeNull();
    expect(publishProblem({ ...ready, status: "active" })).toBeNull();
    expect(publishProblem({ ...ready, product: "store" })).toBeNull();
  });

  it("needs PayPal first", () => {
    expect(publishProblem({ ...ready, paypalMerchantId: null })).toBe("Connect PayPal before you publish.");
  });

  it("needs an active service, or a published product for a store", () => {
    expect(publishProblem({ ...ready, listedCount: 0 })).toBe("Add at least one active service before you publish.");
    expect(publishProblem({ ...ready, product: "store", listedCount: 0 })).toBe(
      "Publish at least one product before you publish your store.",
    );
  });

  it("refuses a suspended seller before anything else", () => {
    expect(publishProblem({ ...ready, status: "suspended", paypalMerchantId: null })).toBe(
      "This seller is suspended. Contact support@payleor.com.",
    );
  });
});
