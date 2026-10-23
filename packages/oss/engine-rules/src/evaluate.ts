import type { RulebookRules } from "./catalog";

// Basis points of an amount, rounded half-up once. BigInt keeps the product exact for safe-integer amounts.
export function bpsOfMinor(minor: number, bps: number): number {
  return Number((BigInt(minor) * BigInt(bps) + 5_000n) / 10_000n);
}

// The upfront rate for a quote: the first matching tier wins, else the default.
export function computeUpfrontBps(rules: RulebookRules, quoteMinor: number): number {
  for (const tier of rules.upfrontTiers.tiers) {
    if (quoteMinor >= tier.minQuoteMinor && (tier.maxQuoteMinor === null || quoteMinor < tier.maxQuoteMinor)) {
      return tier.bps;
    }
  }
  return rules.upfront.defaultBps;
}

export type LateDeliveryRefundProposal = {
  daysLate: number;
  proposedRefundMinor: number;
  ratePerDayBps: number;
  capBps: number;
};

// A proposal only: the platform records it and a person confirms before any money moves.
export function computeLateDeliveryRefundProposal(
  rules: RulebookRules,
  finalPriceMinor: number,
  deadlineAt: Date,
  deliveredAt: Date,
): LateDeliveryRefundProposal {
  const msLate = deliveredAt.getTime() - deadlineAt.getTime();
  const daysLate = msLate > 0 ? Math.ceil(msLate / 86_400_000) : 0;
  const { ratePerDayBps, capBps } = rules.lateDelivery;
  if (daysLate === 0 || ratePerDayBps === 0) {
    return { daysLate, proposedRefundMinor: 0, ratePerDayBps, capBps };
  }
  const totalBps = Math.min(ratePerDayBps * daysLate, capBps);
  return { daysLate, proposedRefundMinor: bpsOfMinor(finalPriceMinor, totalBps), ratePerDayBps, capBps };
}

export type RefundPhase = "before_work" | "in_progress" | "after_delivery";
export type QualityRefundCheck = { allowed: boolean; capMinor: number };

// Ceilings are a share of what the client paid in the current phase.
export function checkQualityRefundCap(
  rules: RulebookRules,
  phase: RefundPhase,
  refundMinor: number,
  paidMinor: number,
): QualityRefundCheck {
  const capBps =
    phase === "before_work" ? rules.qualityRefund.beforeWorkCapBps : phase === "in_progress" ? rules.qualityRefund.inProgressCapBps : rules.qualityRefund.afterDeliveryCapBps;
  const capMinor = bpsOfMinor(paidMinor, capBps);
  return { allowed: refundMinor <= capMinor, capMinor };
}

export type CompletionSplit = { teamCutMinor: number; managerCutMinor: number; memberShareMinor: number };

// The member takes the remainder so the three parts always sum to the price exactly. Without a manager the
// manager's share falls to the member, who carried the manager's duties.
export function computeCompletionSplit(rules: RulebookRules, finalPriceMinor: number, hasManager: boolean): CompletionSplit {
  const teamCutMinor = bpsOfMinor(finalPriceMinor, rules.split.teamCutBps);
  const managerCutMinor = hasManager ? bpsOfMinor(finalPriceMinor, rules.split.managerCutBps) : 0;
  return { teamCutMinor, managerCutMinor, memberShareMinor: finalPriceMinor - teamCutMinor - managerCutMinor };
}
