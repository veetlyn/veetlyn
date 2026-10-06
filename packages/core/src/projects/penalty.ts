import { assertAmount, assertBps, bpsOf } from "../money/money";

const DAY_MS = 86_400_000;

export type PenaltyRule = { ratePerDayBps: number; capBps: number };

// A started day counts as a whole day late.
export function daysLate(deadline: Date, deliveredAt: Date): number {
  const lateMs = deliveredAt.getTime() - deadline.getTime();
  return lateMs <= 0 ? 0 : Math.ceil(lateMs / DAY_MS);
}

// Services spec §5.3 and §7.2: rate per day × days late × quote, capped at capBps of the quote.
export function penaltyMinor(input: { quoteMinor: number; daysLate: number; rule: PenaltyRule }): number {
  assertAmount(input.quoteMinor, "quote");
  assertAmount(input.daysLate, "days late");
  assertBps(input.rule.ratePerDayBps, "penalty rate");
  assertBps(input.rule.capBps, "penalty cap");
  if (input.daysLate === 0) return 0;
  const uncapped = Number(
    (BigInt(input.quoteMinor) * BigInt(input.rule.ratePerDayBps) * BigInt(input.daysLate) + 5_000n) / 10_000n,
  );
  return Math.min(uncapped, bpsOf(input.quoteMinor, input.rule.capBps));
}
