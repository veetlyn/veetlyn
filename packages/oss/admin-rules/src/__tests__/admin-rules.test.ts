import { describe, expect, it } from "vitest";

import {
  AGENCY_RULEBOOK_SPEC,
  RULE_CARDS,
  SOLO_RULEBOOK_SPEC,
  formatClientTermsSummary,
  rulebookToSpec,
} from "@opmodel/engine-rules";

import { majorUnitsToMinor, switchPreset, updateRulebook, updateSplitRule, updateUpfrontTier } from "../index";

describe("rulebook spec cards", () => {
  it("renders one element per rule card under a Rulebook root", () => {
    const spec = rulebookToSpec(SOLO_RULEBOOK_SPEC.rules, "solo");
    const types = new Set(Object.values(spec.elements).map((element) => element.type));
    expect(types).toEqual(new Set(["Rulebook", ...RULE_CARDS.map((card) => card.component)]));
    expect(spec.elements[spec.root]?.children).toHaveLength(RULE_CARDS.length + 1);
  });
});

describe("switchPreset", () => {
  it("replaces the whole rulebook with the chosen preset", () => {
    const switched = switchPreset("solo");
    expect(switched.preset).toBe("solo");
    expect(switched.rules).toEqual(SOLO_RULEBOOK_SPEC.rules);
  });
});

describe("updateRulebook", () => {
  it("applies a field edit and keeps the rulebook valid", () => {
    const updated = updateRulebook(SOLO_RULEBOOK_SPEC.rules, { revisions: { paidRevisionPriceMinor: 60_00 } });
    expect(updated.revisions.paidRevisionPriceMinor).toBe(60_00);
    expect(formatClientTermsSummary(updated, "USD")).toContain("$60.00");
  });

  it("rejects an edit that breaks the split invariant", () => {
    expect(() => updateRulebook(AGENCY_RULEBOOK_SPEC.rules, { split: { memberCutBps: 5_000 } })).toThrow();
  });
});

describe("coordinated rule edits", () => {
  it("parses currency text directly into integer minor units", () => {
    expect(majorUnitsToMinor("1.05")).toBe(105);
    expect(majorUnitsToMinor("1.5")).toBe(150);
    expect(majorUnitsToMinor("")).toBe(0);
    expect(majorUnitsToMinor("1.005")).toBeNull();
    expect(majorUnitsToMinor("90071992547410.00")).toBeNull();
  });

  it("keeps all three split shares at 100 percent when one share changes", () => {
    const team = updateSplitRule(AGENCY_RULEBOOK_SPEC.rules, "teamCutBps", 2_500);
    expect(team.split).toEqual({ teamCutBps: 2_500, managerCutBps: 1_000, memberCutBps: 6_500 });

    const manager = updateSplitRule(AGENCY_RULEBOOK_SPEC.rules, "managerCutBps", 1_500);
    expect(manager.split).toEqual({ teamCutBps: 2_000, managerCutBps: 1_500, memberCutBps: 6_500 });

    const member = updateSplitRule(AGENCY_RULEBOOK_SPEC.rules, "memberCutBps", 6_000);
    expect(member.split).toEqual({ teamCutBps: 2_000, managerCutBps: 2_000, memberCutBps: 6_000 });
    expect(() => updateSplitRule(AGENCY_RULEBOOK_SPEC.rules, "teamCutBps", 10_001)).toThrow();
  });

  it("updates one upfront tier while validating the complete tier list", () => {
    const rules = updateUpfrontTier(AGENCY_RULEBOOK_SPEC.rules, 0, { bps: 4_000 });
    expect(rules.upfrontTiers.tiers[0]?.bps).toBe(4_000);
    expect(rules.upfrontTiers.tiers[1]).toEqual(AGENCY_RULEBOOK_SPEC.rules.upfrontTiers.tiers[1]);
    expect(() => updateUpfrontTier(AGENCY_RULEBOOK_SPEC.rules, 99, { bps: 4_000 })).toThrow();
    expect(() => updateUpfrontTier(AGENCY_RULEBOOK_SPEC.rules, 0, { bps: 10_001 })).toThrow();
  });
});
