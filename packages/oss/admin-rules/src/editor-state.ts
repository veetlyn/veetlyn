import { PRESET_RULEBOOKS, RulebookRulesSchema, type RulebookRules, type RulebookSpec } from "@opmodel/engine-rules";
import { z } from "zod";

export type TeamPreset = "solo" | "agency" | "collective";

// Switching presets replaces the whole rulebook: presets are starting points, not merges.
export function switchPreset(preset: TeamPreset): RulebookSpec {
  return { preset, rules: PRESET_RULEBOOKS[preset].rules };
}

type RecursivePartial<T> = T extends (infer _U)[] ? T : T extends object ? { [K in keyof T]?: RecursivePartial<T[K]> } : T;

export type RulebookChanges = { [K in keyof RulebookRules]?: RecursivePartial<RulebookRules[K]> };

const majorUnitsText = z.string().regex(/^\d+(?:\.\d{0,2})?$/);

export function majorUnitsToMinor(value: string): number | null {
  if (value === "") return 0;
  const parsed = majorUnitsText.safeParse(value);
  if (!parsed.success) return null;
  const [whole, fraction = ""] = value.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

// Applies a partial edit and re-validates the whole rulebook, so an editor can never produce an
// invalid one (the split sum, the reminder-before-window rules, and every bound hold after an edit).
// Arrays (the upfront tiers) replace wholesale: a tier edit sends the full list.
export function updateRulebook(rules: RulebookRules, changes: RulebookChanges): RulebookRules {
  return RulebookRulesSchema.parse({
    upfront: { ...rules.upfront, ...changes.upfront },
    upfrontTiers: { tiers: changes.upfrontTiers?.tiers ?? rules.upfrontTiers.tiers },
    revisions: { ...rules.revisions, ...changes.revisions },
    responseWindow: { ...rules.responseWindow, ...changes.responseWindow },
    updateWindow: { ...rules.updateWindow, ...changes.updateWindow },
    clientSilence: { ...rules.clientSilence, ...changes.clientSilence },
    lateDelivery: { ...rules.lateDelivery, ...changes.lateDelivery },
    qualityRefund: { ...rules.qualityRefund, ...changes.qualityRefund },
    split: { ...rules.split, ...changes.split },
    strikes: { ...rules.strikes, ...changes.strikes },
    leavingNotice: { ...rules.leavingNotice, ...changes.leavingNotice },
    dispute: { ...rules.dispute, ...changes.dispute },
  });
}

export function updateSplitRule(
  rules: RulebookRules,
  field: keyof RulebookRules["split"],
  value: number,
): RulebookRules {
  const split = { ...rules.split, [field]: value };
  if (field === "memberCutBps") {
    split.managerCutBps = 10_000 - split.teamCutBps - value;
  } else {
    split.memberCutBps = 10_000 - split.teamCutBps - split.managerCutBps;
  }
  return updateRulebook(rules, { split });
}

export function updateUpfrontTier(
  rules: RulebookRules,
  index: number,
  changes: Partial<RulebookRules["upfrontTiers"]["tiers"][number]>,
): RulebookRules {
  if (!Number.isInteger(index) || index < 0 || index >= rules.upfrontTiers.tiers.length) {
    throw new RangeError("Choose an existing upfront tier.");
  }
  const tiers = rules.upfrontTiers.tiers.map((tier, currentIndex) =>
    currentIndex === index ? { ...tier, ...changes } : tier,
  );
  return updateRulebook(rules, { upfrontTiers: { tiers } });
}
