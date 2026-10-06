import { describe, expect, it } from "vitest";

import { type PayPalConnection, payPalCardModel } from "./paypal-status";

const base: PayPalConnection = {
  state: "not_connected",
  merchantId: null,
  actionUrl: null,
  paymentsReceivable: null,
  primaryEmailConfirmed: null,
};

describe("payPalCardModel", () => {
  it("offers the connect action before onboarding starts", () => {
    expect(payPalCardModel(base)).toEqual({
      tone: "muted",
      title: "Not connected",
      detail: "Connect PayPal to accept payments.",
      action: "connect",
      actionLabel: "Connect PayPal",
    });
  });

  it("resumes the PayPal flow while the referral is pending", () => {
    const model = payPalCardModel({ ...base, state: "pending", actionUrl: "https://paypal.example/abc" });
    expect(model.action).toBe("resume");
    expect(model.actionLabel).toBe("Continue PayPal setup");
  });

  it("falls back to a status check when the action URL is gone", () => {
    const model = payPalCardModel({ ...base, state: "pending" });
    expect(model.action).toBe("refresh");
  });

  it("names the missing pieces when PayPal has not cleared the account", () => {
    const model = payPalCardModel({
      ...base,
      state: "needs_attention",
      actionUrl: "https://paypal.example/abc",
      merchantId: "SELLER1",
      paymentsReceivable: false,
      primaryEmailConfirmed: false,
    });
    expect(model.tone).toBe("problem");
    expect(model.detail).toContain("receive payments");
    expect(model.detail).toContain("email address");
    expect(model.action).toBe("resume");
    expect(model.actionLabel).toBe("Reopen PayPal setup");
  });

  it("says the account is under review when both flags are already true", () => {
    const model = payPalCardModel({
      ...base,
      state: "needs_attention",
      merchantId: "SELLER1",
      paymentsReceivable: true,
      primaryEmailConfirmed: true,
    });
    expect(model.detail).toContain("reviewing");
    expect(model.action).toBe("refresh");
  });

  it("shows the connected account and no action", () => {
    const model = payPalCardModel({
      ...base,
      state: "connected",
      merchantId: "SELLER1",
      paymentsReceivable: true,
      primaryEmailConfirmed: true,
    });
    expect(model.tone).toBe("success");
    expect(model.detail).toContain("SELLER1");
    expect(model.action).toBeNull();
  });
});
