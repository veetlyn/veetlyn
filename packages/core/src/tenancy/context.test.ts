import { describe, expect, it } from "vitest";

import { createTenantContext } from "./context";

describe("createTenantContext", () => {
  it("copies the store identity and adds channel and environment", () => {
    const context = createTenantContext(
      {
        id: "store-1",
        organizationId: "org-1",
        slug: "acme",
        name: "Acme",
        status: "active",
        paypalMerchantId: "MERCHANT123",
      },
      "admin",
      "sandbox",
    );

    expect(context).toEqual({
      storeId: "store-1",
      organizationId: "org-1",
      slug: "acme",
      paypalMerchantId: "MERCHANT123",
      channel: "admin",
      environment: "sandbox",
    });
  });
});
