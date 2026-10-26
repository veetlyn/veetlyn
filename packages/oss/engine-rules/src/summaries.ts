import type { RulebookRules } from "./catalog";

const currencySymbols = new Map([
  ["USD", "$"],
  ["EUR", "€"],
]);

function formatMinor(currency: string, minor: number): string {
  const symbol = currencySymbols.get(currency) ?? `${currency} `;
  return `${symbol}${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatBps(bps: number): string {
  const percent = bps / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0$/, "")}%`;
}

function asSentences(sentences: (string | null)[]): string[] {
  return sentences.filter((sentence) => sentence !== null).map((sentence) => (sentence.endsWith(".") ? sentence : `${sentence}.`));
}

function tierSentence(currency: string, rules: RulebookRules): string | null {
  const parts = rules.upfrontTiers.tiers.map((tier) => {
    if (tier.maxQuoteMinor !== null) {
      const range = tier.minQuoteMinor > 0
        ? `from ${formatMinor(currency, tier.minQuoteMinor)} to under ${formatMinor(currency, tier.maxQuoteMinor)}`
        : `under ${formatMinor(currency, tier.maxQuoteMinor)}`;
      return `${formatBps(tier.bps)} for quotes ${range}`;
    }
    if (tier.minQuoteMinor > 0) return `${formatBps(tier.bps)} for quotes ${formatMinor(currency, tier.minQuoteMinor)} and up`;
    return `${formatBps(tier.bps)} for all quotes`;
  });
  return parts.length > 0 ? ` (${parts.join("; ")})` : null;
}

function freeRevisions(count: number): string {
  return count === 1 ? "1 free revision" : `${count} free revisions`;
}

// What the client reads before requesting work, one rule per sentence.
export function clientTermsLines(rules: RulebookRules, currency: string): string[] {
  const tiers = tierSentence(currency, rules) ?? "";
  const sentences = [
    `${formatBps(rules.upfront.defaultBps)} upfront to start${tiers}`,
    `You get ${freeRevisions(rules.revisions.freeCount)}; further revisions cost ${formatMinor(currency, rules.revisions.paidRevisionPriceMinor)} each`,
    `The team replies within ${rules.responseWindow.hours} hours of your request`,
    `While work is under way you hear from the team at least every ${rules.updateWindow.hours} hours`,
    rules.lateDelivery.ratePerDayBps > 0
      ? `If delivery runs late, a refund of ${formatBps(rules.lateDelivery.ratePerDayBps)} per day (up to ${formatBps(rules.lateDelivery.capBps)}) is proposed to you`
      : null,
    `After delivery you have ${rules.clientSilence.finalDays} days to review; ${
      rules.clientSilence.silenceOutcome === "accept_and_complete"
        ? `if we hear nothing more, the delivery is accepted and the project completes`
        : `if we hear nothing more, the project ends and the payments already made stay settled`
    }`,
    `Refunds for quality issues are capped at ${formatBps(rules.qualityRefund.beforeWorkCapBps)} before work starts, ${formatBps(
      rules.qualityRefund.inProgressCapBps,
    )} during work and ${formatBps(rules.qualityRefund.afterDeliveryCapBps)} after delivery`,
  ];
  return asSentences(sentences);
}

export function formatClientTermsSummary(rules: RulebookRules, currency: string): string {
  return clientTermsLines(rules, currency).join(" ");
}

// What a team member reads before accepting the team's agreement, one rule per sentence.
export function memberAgreementLines(rules: RulebookRules, currency: string): string[] {
  const sentences = [
    `On completion the price splits ${formatBps(rules.split.teamCutBps)} to the team, ${formatBps(rules.split.managerCutBps)} to your manager and ${formatBps(
      rules.split.memberCutBps,
    )} to you`,
    rules.strikes.threshold > 0
      ? `Marks for missed updates, missed deadlines or quality refunds add up; ${rules.strikes.threshold} marks in ${rules.strikes.windowDays} days suspend you from new requests`
      : null,
    rules.lateDelivery.ratePerDayBps > 0
      ? `Late delivery proposes a refund of ${formatBps(rules.lateDelivery.ratePerDayBps)} per day (up to ${formatBps(rules.lateDelivery.capBps)}) from your share`
      : null,
    rules.leavingNotice.days > 0 ? `To leave the team, give ${rules.leavingNotice.days} days of notice` : null,
    `Each paid revision beyond the ${rules.revisions.freeCount === 1 ? "free round" : `${rules.revisions.freeCount} free rounds`} pays you ${formatMinor(currency, rules.revisions.paidRevisionPriceMinor)}`,
  ];
  return asSentences(sentences);
}

export function formatMemberAgreementSummary(rules: RulebookRules, currency: string): string {
  return memberAgreementLines(rules, currency).join(" ");
}

// With tiers the share depends on the quote, so the one-line summary gives the range rather than a rate a quote may not get.
function compactUpfront(rules: RulebookRules): string {
  const rates = [rules.upfront.defaultBps, ...rules.upfrontTiers.tiers.map((tier) => tier.bps)];
  const [low, high] = [Math.min(...rates), Math.max(...rates)];
  if (rules.upfrontTiers.tiers.length === 0 || low === high) return `${formatBps(rules.upfront.defaultBps)} upfront`;
  return `${formatBps(low).replace("%", "")}–${formatBps(high)} upfront by quote size`;
}

// The one-line card summary shown on client, pay and plugin surfaces.
export function formatCompactRuleSummary(rules: RulebookRules, currency: string): string {
  return `${compactUpfront(rules)} · ${freeRevisions(rules.revisions.freeCount)} (${formatMinor(
    currency,
    rules.revisions.paidRevisionPriceMinor,
  )} each after) · ${rules.clientSilence.finalDays}-day review window`;
}
