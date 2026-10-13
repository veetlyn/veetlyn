import { describe, expect, it } from "vitest";

import {
  approvalState,
  memberPayoutFeeMinor,
  payPalConnectProblem,
  payoutActions,
  payoutFeeLine,
  payoutNetMinor,
  payoutSentMinor,
  waitingLine,
} from "./payouts";

describe("payoutActions", () => {
  it.each([
    ["requested", false, true, ["approve", "reject"]],
    ["queued", false, true, ["reject", "retry"]],
    ["queued", true, true, ["retry"]],
    ["queued", false, false, ["reject"]],
    ["queued", true, false, []],
    ["sending", false, true, []],
    ["sending", true, true, ["retry"]],
    ["sent", false, true, ["refresh"]],
    ["succeeded", false, true, []],
    ["failed", false, true, []],
    ["rejected", false, true, []],
    ["exported", false, false, ["cancel_export"]],
  ] as const)("%s (uncertain: %s, automatic payouts: %s)", (status, uncertain, automaticPayoutsOn, actions) => {
    expect(payoutActions({ status, uncertain }, automaticPayoutsOn)).toEqual(actions);
  });
});

describe("waitingLine", () => {
  const NOW = new Date("2026-10-14T10:00:00Z");

  it.each([
    ["a future payday", "queued", "2026-10-16T00:00:00.000Z", null, "Goes on payday, October 16, 2026"],
    ["a future next try", "queued", null, "2026-10-14T10:15:00.000Z", "Next try Oct 14, 2026, 10:15 AM"],
    ["a payday and a next try already passed", "queued", "2026-10-14T00:00:00.000Z", "2026-10-14T09:45:00.000Z", null],
    ["a payout no longer queued", "sent", "2026-10-16T00:00:00.000Z", null, null],
  ] as const)("%s", (_name, status, sendAfter, nextAttemptAt, line) => {
    expect(waitingLine({ status, sendAfter, nextAttemptAt }, NOW, "UTC")).toBe(line);
  });
});

describe("approvalState", () => {
  const WAITING = "Waiting for a second admin";
  const ADD_ADMIN = "Add a second admin or lower the second-approver amount.";

  it.each([
    ["one approval needed", "requested", 0, 1, 2, { progress: null, note: null }],
    ["two needed, none given", "requested", 0, 2, 2, { progress: "0 of 2 approvals", note: null }],
    ["one of two given", "requested", 1, 1, 1, { progress: "1 of 2 approvals", note: WAITING }],
    ["the only admin left already approved", "requested", 1, 1, 0, { progress: "1 of 2 approvals", note: ADD_ADMIN }],
    ["an admin's own payout needing both of two admins", "requested", 0, 2, 1, { progress: "0 of 2 approvals", note: ADD_ADMIN }],
    ["already approved", "queued", 2, 0, 0, { progress: null, note: null }],
  ] as const)("%s", (_name, status, approvals, approvalsNeeded, eligibleApprovers, state) => {
    expect(approvalState({ status, approvals, approvalsNeeded, eligibleApprovers })).toEqual(state);
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
    ["exported", null, 25, ESTIMATE],
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
    ["exported", 975],
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
