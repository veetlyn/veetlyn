import { describe, expect, it } from "vitest";

import {
  AGENCY_RULEBOOK_SPEC,
  RULE_CARDS,
  SOLO_RULEBOOK_SPEC,
  formatClientTermsSummary,
  rulebookToSpec,
} from "@opmodel/engine-rules";

import { switchPreset, updateRulebook } from "../index";

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
