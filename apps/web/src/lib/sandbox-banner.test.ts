import { describe, expect, it } from "vitest";

import { SANDBOX_NOTICE, sandboxBannerContent } from "./sandbox-banner";

const all = {
  PAYPAL_ENVIRONMENT: "sandbox",
  SANDBOX_BUYER_EMAIL: "buyer@example.com",
  SANDBOX_BUYER_PASSWORD: "buyer-password",
  SANDBOX_CARD_NUMBER: "4111111111111111",
  SANDBOX_CARD_EXPIRY: "12/2030",
  SANDBOX_CARD_CVV: "123",
};

describe("sandboxBannerContent", () => {
  it("shows the notice on ordinary pages", () => {
    expect(sandboxBannerContent("default", all)).toEqual({ kind: "notice", text: SANDBOX_NOTICE });
  });

  it("hides the global banner in production while retaining it for staging demos", () => {
    expect(sandboxBannerContent("default", { ...all, DEPLOY_STAGE: "production" })).toBeNull();
    expect(sandboxBannerContent("default", { ...all, DEPLOY_STAGE: "staging" })).toEqual({ kind: "notice", text: SANDBOX_NOTICE });
  });

  it("adds the buyer login and test card on checkout pages", () => {
    expect(sandboxBannerContent("checkout", all)).toEqual({
      kind: "checkout",
      text: SANDBOX_NOTICE,
      buyer: { email: "buyer@example.com", password: "buyer-password" },
      card: { number: "4111111111111111", expiry: "12/2030", cvv: "123" },
    });
  });

  it("shows nothing outside the PayPal sandbox", () => {
    expect(sandboxBannerContent("default", { ...all, PAYPAL_ENVIRONMENT: "live" })).toBeNull();
    expect(sandboxBannerContent("checkout", { ...all, PAYPAL_ENVIRONMENT: "live" })).toBeNull();
  });

  it("falls back to the notice when any checkout value is missing", () => {
    expect(sandboxBannerContent("checkout", { ...all, SANDBOX_CARD_CVV: "" })).toEqual({
      kind: "notice",
      text: SANDBOX_NOTICE,
    });
  });
});
