import { describe, expect, it } from "vitest";

import { captureOutcomeProblem, type PayPageInput, payPageState, paymentKindLabel, sdkEnvironment } from "./pay-page";

const base: PayPageInput = { kind: "deposit", status: "pending", processing: false, paypalReady: true };

describe("payPageState", () => {
  it("offers the button for a pending or failed payment", () => {
    expect(payPageState(base)).toEqual({ view: "pay" });
    expect(payPageState({ ...base, status: "failed" })).toEqual({ view: "pay" });
  });

  it("shows paid, processing and cancelled payments without a button", () => {
    expect(payPageState({ ...base, status: "captured" })).toEqual({ view: "paid", message: "Paid. Thank you." });
    expect(payPageState({ ...base, processing: true })).toEqual({
      view: "processing",
      message: "PayPal is still processing this payment. This page updates on its own.",
    });
    expect(payPageState({ ...base, status: "cancelled" })).toEqual({ view: "closed", message: "This payment was cancelled." });
  });

  it("offers the button for every kind of payment", () => {
    expect(payPageState({ ...base, kind: "top_up" })).toEqual({ view: "pay" });
    expect(payPageState({ ...base, kind: "balance" })).toEqual({ view: "pay" });
  });

  it("explains why a payment cannot be paid yet", () => {
    expect(payPageState({ ...base, paypalReady: false })).toEqual({
      view: "closed",
      message: "This team cannot take PayPal payments yet. Ask them to connect PayPal.",
    });
  });
});

describe("labels", () => {
  it("names each kind of payment", () => {
    expect(paymentKindLabel("deposit")).toBe("Deposit");
    expect(paymentKindLabel("top_up")).toBe("Top-up");
    expect(paymentKindLabel("balance")).toBe("Balance");
  });

  it("explains a capture that did not complete", () => {
    expect(captureOutcomeProblem("captured")).toBeNull();
    expect(captureOutcomeProblem("pending")).toBeNull();
    expect(captureOutcomeProblem("declined")).toBe("PayPal declined this payment. Try again or choose another way to pay.");
  });

  it("maps Payleor's PayPal environment to the SDK's", () => {
    expect(sdkEnvironment("sandbox")).toBe("sandbox");
    expect(sdkEnvironment("live")).toBe("production");
  });
});
