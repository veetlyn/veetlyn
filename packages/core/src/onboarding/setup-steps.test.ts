import { describe, expect, it } from "vitest";

import { countDone, setupSteps } from "./setup-steps";

const links = { storefrontUrl: "https://acme.payleor.site", productsUrl: "/acme/products" };

describe("setupSteps", () => {
  it("starts a new store with only the first step done", () => {
    const steps = setupSteps({ status: "draft", paypalMerchantId: null }, links, { productCount: 0 });

    expect(steps).toEqual([
      { id: "create-store", label: "Create your store", done: true },
      { id: "add-product", label: "Add your first product", done: false, href: "/acme/products" },
      { id: "connect-paypal", label: "Connect PayPal", done: false },
      { id: "visit-storefront", label: "Visit your storefront", done: false, href: "https://acme.payleor.site" },
    ]);
    expect(countDone(steps)).toBe(1);
  });

  it("marks products done once the store has one, PayPal once a merchant ID is stored, the storefront once live", () => {
    const steps = setupSteps({ status: "active", paypalMerchantId: "MERCHANT1" }, links, { productCount: 2 });

    expect(steps.map((s) => s.done)).toEqual([true, true, true, true]);
    expect(countDone(steps)).toBe(4);
  });
});
