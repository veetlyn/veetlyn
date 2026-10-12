import { describe, expect, it } from "vitest";

import { payoutActions, payoutFeeLine, payoutNetMinor } from "./payouts";

describe("payoutActions", () => {
  it.each([
    ["requested", false, ["approve", "reject"]],
    ["queued", false, ["retry"]],
    ["sending", false, []],
    ["sending", true, ["retry"]],
    ["sent", false, ["refresh"]],
    ["succeeded", false, []],
    ["failed", false, []],
    ["rejected", false, []],
  ] as const)("%s (uncertain: %s)", (status, uncertain, actions) => {
    expect(payoutActions({ status, uncertain })).toEqual(actions);
  });
});

describe("payoutFeeLine", () => {
  it("shows the estimate while the payout has not settled", () => {
    expect(
      payoutFeeLine({ status: "sent", feeMinor: null, feeEstimateMinor: 25, sentMinor: 975 }),
    ).toEqual({ label: "PayPal's fee (about)", feeMinor: 25 });
  });

  it("shows the actual fee once PayPal reports it", () => {
    expect(
      payoutFeeLine({ status: "succeeded", feeMinor: 22, feeEstimateMinor: 25, sentMinor: 975 }),
    ).toEqual({ label: "PayPal's fee", feeMinor: 22 });
  });

  it("hides the fee for payouts that never sent", () => {
    expect(payoutFeeLine({ status: "requested", feeMinor: null, feeEstimateMinor: null, sentMinor: null })).toBeNull();
    expect(payoutFeeLine({ status: "failed", feeMinor: null, feeEstimateMinor: 25, sentMinor: 975 })).toBeNull();
    expect(payoutFeeLine({ status: "rejected", feeMinor: null, feeEstimateMinor: null, sentMinor: null })).toBeNull();
  });
});

describe("payoutNetMinor", () => {
  it("takes the flat US fee off a US-to-US payout", () => {
    expect(payoutNetMinor({ amountMinor: 1000, currency: "USD", senderCountry: "US", receiverCountry: "US" })).toEqual(
      { feeEstimateMinor: 25, netMinor: 975 },
    );
  });

  it("takes the 2% international fee off a cross-border payout", () => {
    expect(payoutNetMinor({ amountMinor: 1000, currency: "USD", senderCountry: "SN", receiverCountry: "US" })).toEqual(
      { feeEstimateMinor: 20, netMinor: 980 },
    );
  });

  it("never returns a negative amount", () => {
    expect(payoutNetMinor({ amountMinor: 10, currency: "USD", senderCountry: "US", receiverCountry: "US" })).toEqual({
      feeEstimateMinor: 25,
      netMinor: 0,
    });
  });
});
