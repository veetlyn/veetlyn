import { describe, expect, it } from "vitest";

import { countDone, setupSteps } from "./setup-steps";

const links = { productsUrl: "/acme/products", connectPaypal: "#paypal", publish: "#publish" };

describe("setupSteps", () => {
  it("starts a new store with only the first step done", () => {
    const steps = setupSteps({ status: "draft", paypalMerchantId: null }, links, { productCount: 0 });

    expect(steps).toEqual([
      { id: "create-store", label: "Create your store", done: true },
      { id: "add-product", label: "Add your first product", done: false, href: "/acme/products" },
      { id: "connect-paypal", label: "Connect PayPal", done: false, href: "#paypal" },
      { id: "publish", label: "Publish your store", done: false, href: "#publish" },
    ]);
    expect(countDone(steps)).toBe(1);
  });

  it("marks products done once the store has one, PayPal once a merchant ID is stored, publish once active", () => {
    const steps = setupSteps({ status: "active", paypalMerchantId: "MERCHANT1" }, links, { productCount: 2 });

    expect(steps.map((s) => s.done)).toEqual([true, true, true, true]);
    expect(steps.at(-1)).toEqual({ id: "publish", label: "Publish your store", done: true, href: "#publish" });
    expect(countDone(steps)).toBe(4);
  });

  it("leaves Connect PayPal as plain text when no link is given", () => {
    const steps = setupSteps({ status: "draft", paypalMerchantId: null }, { ...links, connectPaypal: undefined }, {
      productCount: 0,
    });

    expect(steps.find((s) => s.id === "connect-paypal")).toEqual({ id: "connect-paypal", label: "Connect PayPal", done: false });
  });
});
