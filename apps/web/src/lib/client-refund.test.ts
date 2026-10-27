import { describe, expect, it } from "vitest";

import { clientRefundLabel, paymentRefundLabel, staffRefundAction } from "./client-refund";

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

describe("clientRefundLabel", () => {
  it.each([
    ["requested", null, "Refund of $12.50 due: the team sends it through PayPal"],
    ["issuing", null, "Refund of $12.50: on its way"],
    ["failed", null, "Refund of $12.50: on its way"],
    ["completed", new Date("2026-10-12T09:00:00Z"), "Refunded $12.50 on 2026-10-12"],
  ] as const)("%s", (status, completedAt, label) => {
    expect(clientRefundLabel({ amountMinor: 1250, currency: "USD", status, completedAt }, isoDate)).toBe(label);
  });

  it("reads a serialized completion date", () => {
    expect(
      clientRefundLabel({ amountMinor: 1250, currency: "USD", status: "completed", completedAt: "2026-10-12T09:00:00Z" }, isoDate),
    ).toBe("Refunded $12.50 on 2026-10-12");
  });
});

describe("paymentRefundLabel", () => {
  it.each([
    [{ status: "captured", amountMinor: 5000, refundedMinor: 0 }, null],
    [{ status: "captured", amountMinor: 5000, refundedMinor: 1200 }, "Partly refunded $12.00"],
    [{ status: "refunded", amountMinor: 5000, refundedMinor: 5000 }, "Refunded"],
    [{ status: "captured", amountMinor: 5000, refundedMinor: 5000 }, "Refunded"],
  ])("%o", (payment, label) => {
    expect(paymentRefundLabel(payment, "USD")).toBe(label);
  });
});

describe("staffRefundAction", () => {
  it.each([
    ["requested", [], "refund"],
    ["issuing", [{ status: "pending", sent: true, failureMessage: null }], null],
    ["issuing", [{ status: "completed", sent: true, failureMessage: null }, { status: "pending", sent: false, failureMessage: null }], "retry"],
    [
      "issuing",
      [
        { status: "completed", sent: true, failureMessage: null },
        { status: "pending", sent: false, failureMessage: "We could not confirm the refund with PayPal." },
      ],
      "retry",
    ],
    ["failed", [{ status: "failed", sent: false, failureMessage: "PayPal refused the refund." }], "retry"],
    ["completed", [{ status: "completed", sent: true, failureMessage: null }], null],
  ] as const)("%s with %o", (status, parts, action) => {
    expect(staffRefundAction({ status, parts: [...parts] })).toBe(action);
  });
});
