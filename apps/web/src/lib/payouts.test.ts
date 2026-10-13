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
  const ESTIMATE = { label: "PayPal's fee (about)", feeMinor: 25 };

  it.each([
    ["requested", null, null, null],
    ["queued", null, 25, null],
    ["sending", null, 25, ESTIMATE],
    ["sent", null, 25, ESTIMATE],
    ["succeeded", 22, 25, { label: "PayPal's fee", feeMinor: 22 }],
    ["succeeded", null, 25, ESTIMATE],
    ["failed", null, 25, null],
    ["rejected", null, 25, null],
  ] as const)("%s with fee %s and estimate %s shows %o", (status, feeMinor, feeEstimateMinor, line) => {
    expect(payoutFeeLine({ status, feeMinor, feeEstimateMinor })).toEqual(line);
  });
});

describe("payoutNetMinor", () => {
  const TOO_SMALL = "This payout is too small to cover PayPal's fee.";

  it.each([
    [1000, { feeEstimateMinor: 25, netMinor: 975, tooSmall: null }],
    [10, { feeEstimateMinor: 25, netMinor: 0, tooSmall: TOO_SMALL }],
    [120, { feeEstimateMinor: 25, netMinor: 95, tooSmall: TOO_SMALL }],
    [125, { feeEstimateMinor: 25, netMinor: 100, tooSmall: null }],
  ] as const)("a US-to-US request of %i minor leaves %o", (amountMinor, net) => {
    expect(payoutNetMinor({ amountMinor, currency: "USD", senderCountry: "US", receiverCountry: "US" })).toEqual(net);
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

  it("says the sign-in ran out of time when the state no longer matches", () => {
    expect(payPalConnectProblem(["1", "state_mismatch"])).toMatch(/within 5 minutes/);
  });

  it("asks to try again for any other error", () => {
    expect(payPalConnectProblem("1")).toBe("PayPal did not confirm the connection. Try again.");
    expect(payPalConnectProblem(["1", "access_denied"])).toBe("PayPal did not confirm the connection. Try again.");
  });
});
