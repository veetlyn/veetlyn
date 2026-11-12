import type { PayoutRequestStatus } from "@jendal-workspace/core";

import { payoutSentMinor } from "./payouts";

export type AnalyticsRange = "7d" | "30d" | "90d" | "12m" | "all";

export type AnalyticsPayment = {
  id: string;
  status: string;
  amountMinor: number;
  paypalFeeMinor: number | null;
  refundedMinor: number;
  currency: string;
  capturedAt: string | Date | null;
  createdAt: string | Date;
  kind: string;
  projectId: string;
  projectTitle: string;
  clientName: string | null;
};

export type AnalyticsPayout = {
  status: PayoutRequestStatus;
  amountMinor: number;
  sentMinor: number | null;
  currency: string;
  createdAt: string | Date;
  settledAt: string | Date | null;
};

export type FinancePeriod = {
  grossMinor: number;
  feesMinor: number;
  refundsMinor: number;
  netMinor: number;
  missingFees: number;
  count: number;
  averageMinor: number | null;
  refundRate: number | null;
  feeRate: number | null;
  paidOutMinor: number;
  paidOutCount: number;
  unknownPayoutAmounts: number;
};

export type FinanceBucket = {
  start: string;
  collectedMinor: number;
  previousMinor: number;
  paidOutMinor: number;
};

type DatedPayment = AnalyticsPayment & { capturedDate: Date };
type DatedPayout = AnalyticsPayout & { settledDate: Date };

const DAY_MS = 86_400_000;
const COLLECTED = new Set(["captured", "refunded"]);

function dateOf(value: string | Date | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function utcStartOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function utcStartOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

function addUtcMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function emptyPeriod(): FinancePeriod {
  return {
    grossMinor: 0,
    feesMinor: 0,
    refundsMinor: 0,
    netMinor: 0,
    missingFees: 0,
    count: 0,
    averageMinor: null,
    refundRate: null,
    feeRate: null,
    paidOutMinor: 0,
    paidOutCount: 0,
    unknownPayoutAmounts: 0,
  };
}

function addPayment(period: FinancePeriod, payment: AnalyticsPayment) {
  period.grossMinor += payment.amountMinor;
  period.refundsMinor += payment.refundedMinor;
  period.count += 1;
  if (payment.paypalFeeMinor === null) period.missingFees += 1;
  else period.feesMinor += payment.paypalFeeMinor;
}

function addPayout(period: FinancePeriod, payout: AnalyticsPayout) {
  const sentMinor = payoutSentMinor(payout);
  period.paidOutCount += 1;
  if (sentMinor === null) period.unknownPayoutAmounts += 1;
  else period.paidOutMinor += sentMinor;
}

function finish(period: FinancePeriod): FinancePeriod {
  period.netMinor = period.grossMinor - period.feesMinor - period.refundsMinor;
  period.averageMinor = period.count > 0 ? period.grossMinor / period.count : null;
  period.refundRate = period.grossMinor > 0 ? (period.refundsMinor / period.grossMinor) * 100 : null;
  period.feeRate = period.grossMinor > 0 ? (period.feesMinor / period.grossMinor) * 100 : null;
  return period;
}

function summarize(payments: readonly AnalyticsPayment[], payouts: readonly AnalyticsPayout[]): FinancePeriod {
  const period = emptyPeriod();
  for (const payment of payments) addPayment(period, payment);
  for (const payout of payouts) addPayout(period, payout);
  return finish(period);
}

function inWindow(date: Date, start: Date | null, end: Date): boolean {
  return (!start || date >= start) && date < end;
}

function monthIndex(start: Date, date: Date): number {
  return (date.getUTCFullYear() - start.getUTCFullYear()) * 12 + date.getUTCMonth() - start.getUTCMonth();
}

// Analytics for one currency and one dated cash window. Collections use PayPal capture dates and payouts use
// settlement dates. Refund amounts belong to the captured payments in the same cohort; the feed has no refund
// date, so this deliberately does not present them as refunds processed during the period.
export function collectionAnalytics({
  payments,
  payouts,
  currency,
  range,
  now,
}: {
  payments: readonly AnalyticsPayment[];
  payouts: readonly AnalyticsPayout[];
  currency: string;
  range: AnalyticsRange;
  now: Date;
}) {
  const eligiblePayments = payments.filter((payment) => payment.currency === currency && COLLECTED.has(payment.status));
  const datedPayments: DatedPayment[] = [];
  let undatedPayments = 0;
  for (const payment of eligiblePayments) {
    const capturedDate = dateOf(payment.capturedAt);
    if (capturedDate) datedPayments.push({ ...payment, capturedDate });
    else undatedPayments += 1;
  }

  const eligiblePayouts = payouts.filter((payout) => payout.currency === currency && payout.status === "succeeded");
  const datedPayouts: DatedPayout[] = [];
  let undatedPayouts = 0;
  for (const payout of eligiblePayouts) {
    const settledDate = dateOf(payout.settledAt);
    if (settledDate) datedPayouts.push({ ...payout, settledDate });
    else undatedPayouts += 1;
  }

  const today = utcStartOfDay(now);
  const tomorrow = addUtcDays(today, 1);
  let currentStart: Date | null;
  let previousStart: Date | null = null;
  let previousEnd: Date | null = null;
  let bucketStarts: Date[] = [];
  let bucketIndex: (date: Date, start: Date) => number;
  let previousBucketIndex: (date: Date, start: Date) => number;

  if (range === "7d" || range === "30d" || range === "90d") {
    const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
    currentStart = addUtcDays(today, -(days - 1));
    previousEnd = currentStart;
    previousStart = addUtcDays(currentStart, -days);
    bucketStarts = Array.from({ length: days }, (_, index) => addUtcDays(currentStart!, index));
    bucketIndex = (date, start) => Math.floor((utcStartOfDay(date).getTime() - start.getTime()) / DAY_MS);
    previousBucketIndex = bucketIndex;
  } else if (range === "12m") {
    const thisMonth = utcStartOfMonth(now);
    currentStart = addUtcMonths(thisMonth, -11);
    previousEnd = currentStart;
    previousStart = addUtcMonths(currentStart, -12);
    bucketStarts = Array.from({ length: 12 }, (_, index) => addUtcMonths(currentStart!, index));
    bucketIndex = monthIndex;
    previousBucketIndex = monthIndex;
  } else {
    currentStart = null;
    const earliest = [...datedPayments.map((payment) => payment.capturedDate), ...datedPayouts.map((payout) => payout.settledDate)]
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const firstMonth = utcStartOfMonth(earliest && earliest < tomorrow ? earliest : now);
    const count = monthIndex(firstMonth, now) + 1;
    bucketStarts = Array.from({ length: count }, (_, index) => addUtcMonths(firstMonth, index));
    bucketIndex = monthIndex;
    previousBucketIndex = monthIndex;
  }

  const currentPayments = datedPayments.filter((payment) => inWindow(payment.capturedDate, currentStart, tomorrow));
  const previousPayments = previousStart && previousEnd
    ? datedPayments.filter((payment) => inWindow(payment.capturedDate, previousStart, previousEnd))
    : [];
  const currentPayouts = datedPayouts.filter((payout) => inWindow(payout.settledDate, currentStart, tomorrow));
  const previousPayouts = previousStart && previousEnd
    ? datedPayouts.filter((payout) => inWindow(payout.settledDate, previousStart, previousEnd))
    : [];

  const current = summarize(currentPayments, currentPayouts);
  const previous = previousStart ? summarize(previousPayments, previousPayouts) : null;

  const buckets: FinanceBucket[] = bucketStarts.map((start) => ({
    start: start.toISOString(),
    collectedMinor: 0,
    previousMinor: 0,
    paidOutMinor: 0,
  }));
  const addToBucket = (index: number, update: (bucket: FinanceBucket) => void) => {
    const bucket = buckets[index];
    if (bucket) update(bucket);
  };
  if (currentStart) {
    for (const payment of currentPayments) {
      addToBucket(bucketIndex(payment.capturedDate, currentStart), (bucket) => { bucket.collectedMinor += payment.amountMinor; });
    }
    for (const payment of previousPayments) {
      if (previousStart) addToBucket(previousBucketIndex(payment.capturedDate, previousStart), (bucket) => { bucket.previousMinor += payment.amountMinor; });
    }
    for (const payout of currentPayouts) {
      const sentMinor = payoutSentMinor(payout);
      if (sentMinor !== null) addToBucket(bucketIndex(payout.settledDate, currentStart), (bucket) => { bucket.paidOutMinor += sentMinor; });
    }
  } else {
    const first = bucketStarts[0];
    if (first) {
      for (const payment of currentPayments) addToBucket(monthIndex(first, payment.capturedDate), (bucket) => { bucket.collectedMinor += payment.amountMinor; });
      for (const payout of currentPayouts) {
        const sentMinor = payoutSentMinor(payout);
        if (sentMinor !== null) addToBucket(monthIndex(first, payout.settledDate), (bucket) => { bucket.paidOutMinor += sentMinor; });
      }
    }
  }

  const projectMap = new Map<string, { projectId: string; projectTitle: string; clientName: string | null; grossMinor: number; feesMinor: number; refundsMinor: number; netMinor: number; count: number }>();
  for (const payment of currentPayments) {
    const entry = projectMap.get(payment.projectId) ?? {
      projectId: payment.projectId,
      projectTitle: payment.projectTitle,
      clientName: payment.clientName,
      grossMinor: 0,
      feesMinor: 0,
      refundsMinor: 0,
      netMinor: 0,
      count: 0,
    };
    entry.grossMinor += payment.amountMinor;
    entry.feesMinor += payment.paypalFeeMinor ?? 0;
    entry.refundsMinor += payment.refundedMinor;
    entry.count += 1;
    projectMap.set(payment.projectId, entry);
  }
  const projects = [...projectMap.values()]
    .map((project) => ({ ...project, netMinor: project.grossMinor - project.feesMinor - project.refundsMinor }))
    .sort((a, b) => b.grossMinor - a.grossMinor || b.count - a.count || a.projectTitle.localeCompare(b.projectTitle));

  const kindMap = new Map<string, { kind: string; amountMinor: number; netMinor: number; count: number }>();
  for (const payment of currentPayments) {
    const entry = kindMap.get(payment.kind) ?? { kind: payment.kind, amountMinor: 0, netMinor: 0, count: 0 };
    entry.amountMinor += payment.amountMinor;
    entry.netMinor += payment.amountMinor - (payment.paypalFeeMinor ?? 0) - payment.refundedMinor;
    entry.count += 1;
    kindMap.set(payment.kind, entry);
  }
  const byKind = [...kindMap.values()].sort((a, b) => b.amountMinor - a.amountMinor || a.kind.localeCompare(b.kind));

  return {
    currency,
    range,
    currentStart: currentStart?.toISOString() ?? null,
    currentEnd: tomorrow.toISOString(),
    previousStart: previousStart?.toISOString() ?? null,
    previousEnd: previousEnd?.toISOString() ?? null,
    current,
    previous,
    growthPercent: previous && previous.grossMinor > 0 ? ((current.grossMinor - previous.grossMinor) / previous.grossMinor) * 100 : null,
    buckets,
    projects,
    byKind,
    undatedPayments,
    undatedPayouts,
    unknownPayoutAmounts: current.unknownPayoutAmounts,
  };
}
