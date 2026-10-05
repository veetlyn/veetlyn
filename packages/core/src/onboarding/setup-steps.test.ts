import { describe, expect, it } from "vitest";

import { countDone, setupSteps } from "./setup-steps";

const links = { storefrontUrl: "https://acme.payleor.site" };

describe("setupSteps", () => {
  it("starts a new store with only the first step done", () => {
    const steps = setupSteps({ status: "draft", paypalMerchantId: null }, links);

    expect(steps).toEqual([
      { id: "create-store", label: "Create your store", done: true },
      { id: "connect-paypal", label: "Connect PayPal", done: false },
      { id: "visit-storefront", label: "Visit your storefront", done: false, href: "https://acme.payleor.site" },
    ]);
    expect(countDone(steps)).toBe(1);
  });

  it("marks PayPal done once a merchant ID is stored, and the storefront once the store is live", () => {
    const steps = setupSteps({ status: "active", paypalMerchantId: "MERCHANT1" }, links);

    expect(steps.map((s) => s.done)).toEqual([true, true, true]);
    expect(countDone(steps)).toBe(3);
  });
});
