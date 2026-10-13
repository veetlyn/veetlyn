import { describe, expect, it } from "vitest";

import {
  memberPayoutFeeMinor,
  payPalConnectProblem,
  payoutActions,
  payoutFeeLine,
  payoutNetMinor,
  payoutSentMinor,
} from "./payouts";

describe("payoutActions", () => {
  it.each([
    ["requested", false, ["approve", "reject"]],
    ["queued", false, ["reject", "retry"]],
    ["queued", true, ["retry"]],
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
      { feeEstimateMinor: 25, netMinor: 975, tooSmall: null },
    );
  });

  it("takes the 2% international fee off a cross-border payout", () => {
    expect(payoutNetMinor({ amountMinor: 1000, currency: "USD", senderCountry: "SN", receiverCountry: "US" })).toEqual(
      { feeEstimateMinor: 20, netMinor: 980, tooSmall: null },
    );
  });

  it("never returns a negative amount", () => {
    expect(payoutNetMinor({ amountMinor: 10, currency: "USD", senderCountry: "US", receiverCountry: "US" })).toEqual({
      feeEstimateMinor: 25,
      netMinor: 0,
      tooSmall: "This payout is too small to cover PayPal's fee.",
    });
  });

  it("flags an amount whose payout would fall below PayPal's minimum after the fee", () => {
    expect(
      payoutNetMinor({ amountMinor: 120, currency: "USD", senderCountry: "US", receiverCountry: "US" }).tooSmall,
    ).toBe("This payout is too small to cover PayPal's fee.");
    expect(
      payoutNetMinor({ amountMinor: 125, currency: "USD", senderCountry: "US", receiverCountry: "US" }).tooSmall,
    ).toBeNull();
  });
});

describe("payoutSentMinor", () => {
  it.each([
    ["sending", 975],
    ["sent", 975],
    ["succeeded", 975],
    ["queued", null],
    ["failed", null],
    ["rejected", null],
  ] as const)("%s shows %s", (status, sent) => {
    expect(payoutSentMinor({ status, sentMinor: 975 })).toBe(sent);
  });
});

describe("memberPayoutFeeMinor", () => {
  it("is PayPal's fee when it is at most the estimate", () => {
    expect(memberPayoutFeeMinor({ status: "succeeded", feeMinor: 22, feeEstimateMinor: 25 })).toBe(22);
  });

  it("stops at the estimate when PayPal charged more, since the team bears the rest", () => {
    expect(memberPayoutFeeMinor({ status: "succeeded", feeMinor: 40, feeEstimateMinor: 25 })).toBe(25);
  });

  it("is the estimate when PayPal's fee could not be read", () => {
    expect(memberPayoutFeeMinor({ status: "succeeded", feeMinor: null, feeEstimateMinor: 25 })).toBe(25);
  });

  it("is nothing before the payout succeeds", () => {
    expect(memberPayoutFeeMinor({ status: "sent", feeMinor: null, feeEstimateMinor: 25 })).toBeNull();
    expect(memberPayoutFeeMinor({ status: "failed", feeMinor: null, feeEstimateMinor: 25 })).toBeNull();
  });
});

describe("payPalConnectProblem", () => {
  it("is nothing without an error", () => {
    expect(payPalConnectProblem(undefined)).toBeNull();
  });

  it("names a PayPal account that already belongs to another Payleor account", () => {
    expect(payPalConnectProblem(["1", "account_already_linked_to_different_user"])).toMatch(
      /already connected to another Payleor account/,
    );
  });

  it("asks to try again for any other error", () => {
    expect(payPalConnectProblem("1")).toBe("PayPal did not confirm the connection. Try again.");
    expect(payPalConnectProblem(["1", "access_denied"])).toBe("PayPal did not confirm the connection. Try again.");
  });
});
