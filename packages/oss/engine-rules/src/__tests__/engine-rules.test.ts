import { describe, expect, it } from "vitest";

import {
  clientTermsLines,
  AGENCY_RULEBOOK_SPEC,
  COLLECTIVE_RULEBOOK_SPEC,
  RULEBOOK_CATALOG,
  SOLO_RULEBOOK_SPEC,
  RulebookRulesSchema,
  checkQualityRefundCap,
  computeCompletionSplit,
  computeLateDeliveryRefundProposal,
  computeUpfrontBps,
  formatClientTermsSummary,
  formatCompactRuleSummary,
  formatMemberAgreementSummary,
  rulebookToSpec,
  specToRulebook,
} from "../index";

const T = (iso: string) => new Date(iso);

describe("preset rulebooks", () => {
  it("solo seeds the freelancer defaults: no cuts, no penalties, full protection off", () => {
    expect(SOLO_RULEBOOK_SPEC.preset).toBe("solo");
    expect(SOLO_RULEBOOK_SPEC.rules.upfront).toEqual({ defaultBps: 5000 });
    expect(SOLO_RULEBOOK_SPEC.rules.upfrontTiers).toEqual({
      tiers: [
        { minQuoteMinor: 1000_00, maxQuoteMinor: null, bps: 5000 },
        { minQuoteMinor: 0, maxQuoteMinor: 300_00, bps: 10000 },
      ],
    });
    expect(SOLO_RULEBOOK_SPEC.rules.revisions).toEqual({ freeCount: 2, paidRevisionPriceMinor: 50_00 });
    expect(SOLO_RULEBOOK_SPEC.rules.responseWindow).toEqual({ hours: 48, remindBeforeHours: 12 });
    expect(SOLO_RULEBOOK_SPEC.rules.updateWindow).toEqual({ hours: 72, remindBeforeHours: 12 });
    expect(SOLO_RULEBOOK_SPEC.rules.clientSilence).toEqual({
      firstReminderDays: 5,
      secondReminderDays: 10,
      finalDays: 14,
      silenceOutcome: "accept_and_complete",
    });
    expect(SOLO_RULEBOOK_SPEC.rules.lateDelivery).toEqual({ ratePerDayBps: 0, capBps: 0 });
    expect(SOLO_RULEBOOK_SPEC.rules.qualityRefund).toEqual({ beforeWorkCapBps: 10000, inProgressCapBps: 5000, afterDeliveryCapBps: 2500 });
    expect(SOLO_RULEBOOK_SPEC.rules.split).toEqual({ teamCutBps: 0, managerCutBps: 0, memberCutBps: 10000 });
    expect(SOLO_RULEBOOK_SPEC.rules.strikes).toEqual({ threshold: 0, windowDays: 30 });
    expect(SOLO_RULEBOOK_SPEC.rules.leavingNotice).toEqual({ days: 0 });
  });

  it("agency seeds team rates: 20/10/70 split, late refund, strikes and notice", () => {
    expect(AGENCY_RULEBOOK_SPEC.preset).toBe("agency");
    expect(AGENCY_RULEBOOK_SPEC.rules.revisions).toEqual({ freeCount: 2, paidRevisionPriceMinor: 75_00 });
    expect(AGENCY_RULEBOOK_SPEC.rules.updateWindow).toEqual({ hours: 48, remindBeforeHours: 8 });
    expect(AGENCY_RULEBOOK_SPEC.rules.lateDelivery).toEqual({ ratePerDayBps: 200, capBps: 2000 });
    expect(AGENCY_RULEBOOK_SPEC.rules.split).toEqual({ teamCutBps: 2000, managerCutBps: 1000, memberCutBps: 7000 });
    expect(AGENCY_RULEBOOK_SPEC.rules.strikes).toEqual({ threshold: 3, windowDays: 30 });
    expect(AGENCY_RULEBOOK_SPEC.rules.leavingNotice).toEqual({ days: 14 });
    expect(AGENCY_RULEBOOK_SPEC.rules.clientSilence.silenceOutcome).toBe("accept_and_complete");
  });

  it("collective seeds co-op rates: 10/0/90 split, gentler late refund, 7-day notice", () => {
    expect(COLLECTIVE_RULEBOOK_SPEC.preset).toBe("collective");
    expect(COLLECTIVE_RULEBOOK_SPEC.rules.revisions).toEqual({ freeCount: 2, paidRevisionPriceMinor: 60_00 });
    expect(COLLECTIVE_RULEBOOK_SPEC.rules.updateWindow).toEqual({ hours: 72, remindBeforeHours: 12 });
    expect(COLLECTIVE_RULEBOOK_SPEC.rules.lateDelivery).toEqual({ ratePerDayBps: 100, capBps: 1000 });
    expect(COLLECTIVE_RULEBOOK_SPEC.rules.split).toEqual({ teamCutBps: 1000, managerCutBps: 0, memberCutBps: 9000 });
    expect(COLLECTIVE_RULEBOOK_SPEC.rules.leavingNotice).toEqual({ days: 7 });
  });

  it("validates every preset against the zod schema and the json-render catalog", () => {
    for (const preset of [SOLO_RULEBOOK_SPEC, AGENCY_RULEBOOK_SPEC, COLLECTIVE_RULEBOOK_SPEC]) {
      expect(RulebookRulesSchema.parse(preset.rules)).toEqual(preset.rules);
      const validation = RULEBOOK_CATALOG.validate(rulebookToSpec(preset.rules, preset.preset));
      expect(validation.success, JSON.stringify(validation.error?.issues)).toBe(true);
    }
  });

  it("rejects a split whose cuts do not sum to 100%", () => {
    expect(() =>
      RulebookRulesSchema.parse({ ...AGENCY_RULEBOOK_SPEC.rules, split: { teamCutBps: 2000, managerCutBps: 1000, memberCutBps: 6000 } }),
    ).toThrow();
  });

  it("round-trips a rulebook through the json-render spec", () => {
    expect(specToRulebook(rulebookToSpec(AGENCY_RULEBOOK_SPEC.rules, "agency"))).toEqual(AGENCY_RULEBOOK_SPEC.rules);
  });
});

describe("computeUpfrontBps", () => {
  it("matches tiers by quote size and falls back to the default rate between them", () => {
    expect(computeUpfrontBps(AGENCY_RULEBOOK_SPEC.rules, 200_00)).toBe(10000);
    expect(computeUpfrontBps(AGENCY_RULEBOOK_SPEC.rules, 299_99)).toBe(10000);
    expect(computeUpfrontBps(AGENCY_RULEBOOK_SPEC.rules, 300_00)).toBe(5000);
    expect(computeUpfrontBps(AGENCY_RULEBOOK_SPEC.rules, 999_99)).toBe(5000);
    expect(computeUpfrontBps(AGENCY_RULEBOOK_SPEC.rules, 1000_00)).toBe(5000);
  });

  it("returns the default rate when the rulebook has no tiers", () => {
    const rules = { ...AGENCY_RULEBOOK_SPEC.rules, upfrontTiers: { tiers: [] } };
    expect(computeUpfrontBps(rules, 200_00)).toBe(5000);
  });
});

describe("computeLateDeliveryRefundProposal", () => {
  it("proposes rate per day capped by the rulebook cap", () => {
    const rules = AGENCY_RULEBOOK_SPEC.rules;
    expect(computeLateDeliveryRefundProposal(rules, 1000_00, T("2026-10-01T00:00:00Z"), T("2026-10-04T00:00:00Z"))).toEqual({
      daysLate: 3,
      proposedRefundMinor: 60_00,
      ratePerDayBps: 200,
      capBps: 2000,
    });
    expect(computeLateDeliveryRefundProposal(rules, 1000_00, T("2026-10-01T00:00:00Z"), T("2026-10-16T00:00:00Z")).proposedRefundMinor).toBe(200_00);
  });

  it("proposes nothing when delivered on time or when the rule is off", () => {
    expect(computeLateDeliveryRefundProposal(AGENCY_RULEBOOK_SPEC.rules, 1000_00, T("2026-10-01T12:00:00Z"), T("2026-10-01T00:00:00Z")).proposedRefundMinor).toBe(0);
    expect(computeLateDeliveryRefundProposal(SOLO_RULEBOOK_SPEC.rules, 1000_00, T("2026-10-01T00:00:00Z"), T("2026-10-04T00:00:00Z"))).toMatchObject({
      daysLate: 3,
      proposedRefundMinor: 0,
      ratePerDayBps: 0,
    });
  });
});

describe("checkQualityRefundCap", () => {
  it("allows refunds within the phase cap and reports the ceiling", () => {
    const rules = AGENCY_RULEBOOK_SPEC.rules;
    expect(checkQualityRefundCap(rules, "before_work", 100_00, 1000_00)).toEqual({ allowed: true, capMinor: 1000_00 });
    expect(checkQualityRefundCap(rules, "in_progress", 50_00, 1000_00)).toEqual({ allowed: true, capMinor: 500_00 });
    expect(checkQualityRefundCap(rules, "after_delivery", 25_00, 1000_00)).toEqual({ allowed: true, capMinor: 250_00 });
  });

  it("rejects refunds above the phase cap", () => {
    const rules = AGENCY_RULEBOOK_SPEC.rules;
    expect(checkQualityRefundCap(rules, "in_progress", 500_01, 1000_00).allowed).toBe(false);
    expect(checkQualityRefundCap(rules, "after_delivery", 250_01, 1000_00).allowed).toBe(false);
  });
});

describe("computeCompletionSplit", () => {
  it("splits exactly between team, manager and member", () => {
    expect(computeCompletionSplit(AGENCY_RULEBOOK_SPEC.rules, 1000_00, true)).toEqual({
      teamCutMinor: 200_00,
      managerCutMinor: 100_00,
      memberShareMinor: 700_00,
    });
  });

  it("gives the manager's cut to the member when no manager is assigned, keeping the sum exact", () => {
    expect(computeCompletionSplit(AGENCY_RULEBOOK_SPEC.rules, 1000_00, false)).toEqual({
      teamCutMinor: 200_00,
      managerCutMinor: 0,
      memberShareMinor: 800_00,
    });
  });

  it("keeps the cut sum equal to the price when rounding is needed", () => {
    const split = computeCompletionSplit(AGENCY_RULEBOOK_SPEC.rules, 999_99, true);
    expect(split.teamCutMinor + split.managerCutMinor + split.memberShareMinor).toBe(999_99);
  });
});

describe("summaries", () => {
  it.each([
    { bps: 1, percentage: "0.01%" }, { bps: 101, percentage: "1.01%" },
    { bps: 1010, percentage: "10.1%" }, { bps: 10000, percentage: "100%" },
  ])("preserves $bps basis points in every consent summary", ({ bps, percentage }) => {
    const rules = {
      ...AGENCY_RULEBOOK_SPEC.rules,
      upfront: { defaultBps: bps },
      lateDelivery: { ratePerDayBps: bps, capBps: 10000 },
    };
    expect(formatClientTermsSummary(rules, "USD")).toContain(`${percentage} upfront`);
    expect(formatMemberAgreementSummary(rules, "USD")).toContain(`${percentage} per day`);
    expect(formatCompactRuleSummary(rules, "USD")).toContain(`${percentage} upfront`);
  });

  it("describes the actual lower and exclusive upper bounds of editable upfront tiers", () => {
    const rules = {
      ...AGENCY_RULEBOOK_SPEC.rules,
      upfrontTiers: { tiers: [{ minQuoteMinor: 10000, maxQuoteMinor: 30000, bps: 10000 }] },
    };
    expect(formatClientTermsSummary(rules, "USD")).toContain("100% for quotes from $100.00 to under $300.00");
    const large = { ...rules, upfrontTiers: { tiers: [{ minQuoteMinor: 100_000, maxQuoteMinor: null, bps: 5000 }] } };
    expect(clientTermsLines(large, "USD")[0]).toBe("50% upfront to start (50% for quotes $1,000.00 and up).");
    expect(computeUpfrontBps(rules, 5000)).toBe(5000);
    expect(computeUpfrontBps(rules, 10000)).toBe(10000);
    expect(computeUpfrontBps(rules, 30000)).toBe(5000);
    expect(formatClientTermsSummary({ ...rules, upfrontTiers: { tiers: [{ minQuoteMinor: 0, maxQuoteMinor: null, bps: 10000 }] } }, "USD"))
      .toContain("100% for all quotes");
  });

  it("writes client terms in plain English with the team's numbers", () => {
    const summary = formatClientTermsSummary(AGENCY_RULEBOOK_SPEC.rules, "USD");
    expect(summary).toContain("50% upfront");
    expect(summary).toContain("2 free revisions");
    expect(summary).toContain("$75.00");
    expect(summary).toContain("48 hours");
    const oneRound = { ...AGENCY_RULEBOOK_SPEC.rules, revisions: { ...AGENCY_RULEBOOK_SPEC.rules.revisions, freeCount: 1 } };
    expect(formatClientTermsSummary(oneRound, "USD")).toContain("You get 1 free revision;");
  });

  it("writes the member agreement with the split, strikes and notice", () => {
    const summary = formatMemberAgreementSummary(AGENCY_RULEBOOK_SPEC.rules, "USD");
    expect(summary).toContain("70%");
    expect(summary).toContain("3");
    expect(summary).toContain("14 days");
  });

  it("writes the compact card summary", () => {
    expect(formatCompactRuleSummary(AGENCY_RULEBOOK_SPEC.rules, "USD")).toBe("50% upfront · 2 free revisions ($75.00 each after) · 14-day review window");
  });
});
