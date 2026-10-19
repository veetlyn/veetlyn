import { describe, expect, it } from "vitest";

import { bundleQuote } from "./bundles";
import { getPlan } from "./plans";
import { getSellerPlan } from "./seller-plans";

describe("bundleQuote", () => {
  it("halves the cheaper plan and keeps the dearer one", () => {
    expect(bundleQuote(getSellerPlan("team"), getPlan("grow"), "monthly")).toEqual({
      fullCents: 5900,
      discountedCents: 1950,
      totalCents: 7850,
      savedCents: 1950,
      feeBps: 50,
      discountedProduct: "store",
    });
  });

  it("halves the services plan when the store plan costs more", () => {
    expect(bundleQuote(getSellerPlan("solo"), getPlan("scale"), "yearly")).toMatchObject({
      fullCents: 9900,
      discountedCents: 800,
      totalCents: 10_700,
      discountedProduct: "services",
    });
  });

  it("takes the lower fee of the two plans", () => {
    expect(bundleQuote(getSellerPlan("solo"), getPlan("scale"), "monthly").feeBps).toBe(50);
    expect(bundleQuote(getSellerPlan("agency"), getPlan("starter"), "monthly").feeBps).toBe(25);
  });
});
