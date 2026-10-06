import { describe, expect, it } from "vitest";

import { createMemoryLedger } from "./ledger";
import { completionTransfer, paymentCapturedTransfer, payoutRequestedTransfer, refundRequestedTransfer } from "./postings";

const base = { currency: "USD", projectId: "p1" } as const;

describe("memory ledger", () => {
  it("runs the §5.3 example to the balances of §6.2", async () => {
    const ledger = createMemoryLedger();
    await ledger.post([paymentCapturedTransfer({ ...base, paymentId: "dep", quotePartMinor: 50_000, managementFeeMinor: 10_000 })]);
    await ledger.post([paymentCapturedTransfer({ ...base, paymentId: "bal", quotePartMinor: 35_000, managementFeeMinor: 0 })]);
    await ledger.post([completionTransfer({ ...base, freelancerId: "f1", finalPriceMinor: 85_000, teamCutBps: 1_500 })]);

    expect(await ledger.balance("client_held:p1", "USD")).toBe(0);
    expect(await ledger.balance("team_revenue", "USD")).toBe(22_750);
    expect(await ledger.balance("owed:f1:available", "USD")).toBe(72_250);
    expect(await ledger.balance("paypal_clearing", "USD")).toBe(-95_000);
  });

  it("refuses a payout above the available earnings and writes nothing", async () => {
    const ledger = createMemoryLedger();
    await ledger.post([paymentCapturedTransfer({ ...base, paymentId: "dep", quotePartMinor: 1_000, managementFeeMinor: 0 })]);
    await ledger.post([completionTransfer({ ...base, freelancerId: "f1", finalPriceMinor: 1_000, teamCutBps: 0 })]);

    await expect(
      ledger.post([payoutRequestedTransfer({ currency: "USD", payoutRequestId: "po1", freelancerId: "f1", amountMinor: 1_001 })]),
    ).rejects.toMatchObject({ code: "negative_balance" });
    expect(await ledger.balance("owed:f1:available", "USD")).toBe(1_000);
    expect(await ledger.balance("owed:f1:reserved", "USD")).toBe(0);
  });

  it("refuses to refund more client money than it holds", async () => {
    const ledger = createMemoryLedger();
    await expect(
      ledger.post([refundRequestedTransfer({ ...base, refundId: "r1", quotePartMinor: 1, managementFeeMinor: 0 })]),
    ).rejects.toMatchObject({ code: "negative_balance" });
  });

  it("posts a batch all or nothing and never twice", async () => {
    const ledger = createMemoryLedger();
    const deposit = paymentCapturedTransfer({ ...base, paymentId: "dep", quotePartMinor: 500, managementFeeMinor: 100 });
    const tooMuch = refundRequestedTransfer({ ...base, refundId: "r1", quotePartMinor: 501, managementFeeMinor: 0 });

    await expect(ledger.post([deposit, tooMuch])).rejects.toMatchObject({ code: "negative_balance" });
    expect(ledger.posted()).toEqual([]);

    await ledger.post([deposit]);
    await expect(ledger.post([deposit])).rejects.toMatchObject({ code: "duplicate_reference" });
    expect(ledger.posted()).toHaveLength(1);
  });
});
