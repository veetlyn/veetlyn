import { describe, expect, it } from "vitest";

import { collectionAnalytics, type AnalyticsPayment, type AnalyticsPayout } from "./finance-analytics";

const now = new Date("2026-11-12T12:00:00Z");
const base: AnalyticsPayment = { id: "p1", status: "captured", amountMinor: 10000, paypalFeeMinor: 400, refundedMinor: 1000, currency: "USD", capturedAt: "2026-11-10T12:00:00Z", createdAt: "2026-10-01T00:00:00Z", kind: "deposit", projectId: "project1", projectTitle: "Brand refresh", clientName: "Client" };
const paid: AnalyticsPayout = { status: "succeeded", amountMinor: 5000, sentMinor: 4900, currency: "USD", createdAt: "2026-09-01T00:00:00Z", settledAt: "2026-11-11T12:00:00Z" };

function model(payments: AnalyticsPayment[], payouts: AnalyticsPayout[] = [], currency = "USD") {
  return collectionAnalytics({ payments, payouts, currency, range: "30d", now });
}

describe("collection analytics", () => {
  it("uses capture dates, includes both range boundaries, and compares equal UTC day windows", () => {
    const a = model([
      base,
      { ...base, id: "start", capturedAt: "2026-10-14T00:00:00Z", amountMinor: 2000, refundedMinor: 0 },
      { ...base, id: "prior", capturedAt: "2026-10-13T23:59:59Z", amountMinor: 4000 },
      { ...base, id: "future", capturedAt: "2026-11-13T00:00:00Z" },
      { ...base, id: "pending", status: "pending", capturedAt: null },
      { ...base, id: "unknown", capturedAt: null },
    ]);
    expect(a.current.grossMinor).toBe(12000);
    expect(a.previous?.grossMinor).toBe(4000);
    expect(a.buckets).toHaveLength(30);
    expect(a.buckets.reduce((sum, b) => sum + b.collectedMinor, 0)).toBe(12000);
    expect(a.buckets.reduce((sum, b) => sum + b.previousMinor, 0)).toBe(4000);
    expect(a.undatedPayments).toBe(1);
    expect(a.current.count).toBe(2);
  });

  it("reconciles the captured-payment cohort without claiming profit or dated refunds", () => {
    const a = model([base, { ...base, id: "p2", status: "refunded", amountMinor: 2000, refundedMinor: 2000, paypalFeeMinor: null }]);
    expect(a.current).toMatchObject({ grossMinor: 12000, feesMinor: 400, refundsMinor: 3000, netMinor: 8600, missingFees: 1, count: 2, averageMinor: 6000, refundRate: 25 });
    expect(a.projects[0]).toMatchObject({ grossMinor: 12000, netMinor: 8600, count: 2 });
    expect(a.byKind.reduce((sum, k) => sum + k.amountMinor, 0)).toBe(12000);
  });

  it("uses settlement dates for payouts and never estimates a missing amount received", () => {
    const a = model([base], [paid, { ...paid, status: "sending" }, { ...paid, settledAt: null }, { ...paid, sentMinor: null }]);
    expect(a.current.paidOutMinor).toBe(4900);
    expect(a.buckets.reduce((sum, b) => sum + b.paidOutMinor, 0)).toBe(4900);
    expect(a.undatedPayouts).toBe(1);
    expect(a.unknownPayoutAmounts).toBe(1);
  });

  it("never mixes currencies and leaves a zero-baseline percentage undefined", () => {
    const a = model([base, { ...base, id: "euro", currency: "EUR", amountMinor: 900000 }], [paid, { ...paid, currency: "EUR" }]);
    expect(a.current.grossMinor).toBe(10000);
    expect(a.growthPercent).toBeNull();
    expect(a.current.paidOutMinor).toBe(4900);
  });

  it("all time has no invented comparison and an honest empty range", () => {
    const a = collectionAnalytics({ payments: [], payouts: [], currency: "USD", range: "all", now });
    expect(a.previous).toBeNull();
    expect(a.current.count).toBe(0);
    expect(a.current.averageMinor).toBeNull();
    expect(a.current.refundRate).toBeNull();
    expect(a.buckets.reduce((sum, b) => sum + b.collectedMinor, 0)).toBe(0);
  });
});
