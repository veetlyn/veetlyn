import { RulebookRulesSchema, type RulebookSpec } from "./catalog";

// The three team-kind presets from the operating model design. Parsed at load so a preset that stops
// validating fails here, not in a team's dashboard.
const soloRules = {
  upfront: { defaultBps: 5_000 },
  upfrontTiers: {
    tiers: [
      { minQuoteMinor: 100_000, maxQuoteMinor: null, bps: 5_000 },
      { minQuoteMinor: 0, maxQuoteMinor: 30_000, bps: 10_000 },
    ],
  },
  revisions: { freeCount: 2, paidRevisionPriceMinor: 5_000 },
  responseWindow: { hours: 48, remindBeforeHours: 12 },
  updateWindow: { hours: 72, remindBeforeHours: 12 },
  clientSilence: { firstReminderDays: 5, secondReminderDays: 10, finalDays: 14, silenceOutcome: "accept_and_complete" },
  lateDelivery: { ratePerDayBps: 0, capBps: 0 },
  qualityRefund: { beforeWorkCapBps: 10_000, inProgressCapBps: 5_000, afterDeliveryCapBps: 2_500 },
  split: { teamCutBps: 0, managerCutBps: 0, memberCutBps: 10_000 },
  strikes: { threshold: 0, windowDays: 30 },
  leavingNotice: { days: 0 },
  dispute: { discussionDays: 3, reviewDays: 10, decisionDays: 5 },
};

const agencyRules = {
  ...soloRules,
  revisions: { freeCount: 2, paidRevisionPriceMinor: 7_500 },
  updateWindow: { hours: 48, remindBeforeHours: 8 },
  lateDelivery: { ratePerDayBps: 200, capBps: 2_000 },
  split: { teamCutBps: 2_000, managerCutBps: 1_000, memberCutBps: 7_000 },
  strikes: { threshold: 3, windowDays: 30 },
  leavingNotice: { days: 14 },
};

const collectiveRules = {
  ...soloRules,
  revisions: { freeCount: 2, paidRevisionPriceMinor: 6_000 },
  lateDelivery: { ratePerDayBps: 100, capBps: 1_000 },
  split: { teamCutBps: 1_000, managerCutBps: 0, memberCutBps: 9_000 },
  leavingNotice: { days: 7 },
};

export const SOLO_RULEBOOK_SPEC: RulebookSpec = { preset: "solo", rules: RulebookRulesSchema.parse(soloRules) };
export const AGENCY_RULEBOOK_SPEC: RulebookSpec = { preset: "agency", rules: RulebookRulesSchema.parse(agencyRules) };
export const COLLECTIVE_RULEBOOK_SPEC: RulebookSpec = { preset: "collective", rules: RulebookRulesSchema.parse(collectiveRules) };

export const PRESET_RULEBOOKS = {
  solo: SOLO_RULEBOOK_SPEC,
  agency: AGENCY_RULEBOOK_SPEC,
  collective: COLLECTIVE_RULEBOOK_SPEC,
} as const;
