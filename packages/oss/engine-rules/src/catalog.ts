import { defineCatalog, defineSchema, type Spec } from "@json-render/core";
import { z } from "zod";

// The twelve rule families of a team's operating model. Props schemas are the single source of truth: the
// rulebook zod schema and the json-render catalog components both read them.
const bps = z.number().int().min(0).max(10_000);
const positiveInt = z.number().int().positive();
const nonNegativeInt = z.number().int().nonnegative();

export const upfrontRuleSchema = z.strictObject({ defaultBps: bps });
export const upfrontTierSchema = z.strictObject({ minQuoteMinor: nonNegativeInt, maxQuoteMinor: positiveInt.nullable(), bps });
export const upfrontTiersRuleSchema = z.strictObject({ tiers: z.array(upfrontTierSchema) });
export const revisionsRuleSchema = z.strictObject({ freeCount: nonNegativeInt, paidRevisionPriceMinor: nonNegativeInt });
export const responseWindowRuleSchema = z.strictObject({ hours: positiveInt, remindBeforeHours: nonNegativeInt });
export const updateWindowRuleSchema = z.strictObject({ hours: positiveInt, remindBeforeHours: nonNegativeInt });
export const clientSilenceRuleSchema = z.strictObject({
  firstReminderDays: positiveInt,
  secondReminderDays: positiveInt,
  finalDays: positiveInt,
  silenceOutcome: z.enum(["accept_and_complete", "abandon"]),
});
export const lateDeliveryRuleSchema = z.strictObject({ ratePerDayBps: bps, capBps: bps });
export const qualityRefundRuleSchema = z.strictObject({ beforeWorkCapBps: bps, inProgressCapBps: bps, afterDeliveryCapBps: bps });
export const splitRuleSchema = z.strictObject({ teamCutBps: bps, managerCutBps: bps, memberCutBps: bps });
export const strikesRuleSchema = z.strictObject({ threshold: nonNegativeInt, windowDays: positiveInt });
export const leavingNoticeRuleSchema = z.strictObject({ days: nonNegativeInt });
export const disputeRuleSchema = z.strictObject({ discussionDays: positiveInt, reviewDays: positiveInt, decisionDays: positiveInt });

export const RulebookRulesSchema = z
  .strictObject({
    upfront: upfrontRuleSchema,
    upfrontTiers: upfrontTiersRuleSchema,
    revisions: revisionsRuleSchema,
    responseWindow: responseWindowRuleSchema,
    updateWindow: updateWindowRuleSchema,
    clientSilence: clientSilenceRuleSchema,
    lateDelivery: lateDeliveryRuleSchema,
    qualityRefund: qualityRefundRuleSchema,
    split: splitRuleSchema,
    strikes: strikesRuleSchema,
    leavingNotice: leavingNoticeRuleSchema,
    dispute: disputeRuleSchema,
  })
  .superRefine((rules, ctx) => {
    const { teamCutBps, managerCutBps, memberCutBps } = rules.split;
    if (teamCutBps + managerCutBps + memberCutBps !== 10_000) {
      ctx.addIssue({ code: "custom", path: ["split"], message: "cuts must sum to 10000 basis points" });
    }
    if (rules.responseWindow.remindBeforeHours >= rules.responseWindow.hours) {
      ctx.addIssue({ code: "custom", path: ["responseWindow", "remindBeforeHours"], message: "reminder must come before the window closes" });
    }
    if (rules.updateWindow.remindBeforeHours >= rules.updateWindow.hours) {
      ctx.addIssue({ code: "custom", path: ["updateWindow", "remindBeforeHours"], message: "reminder must come before the window closes" });
    }
  });

export type RulebookRules = z.output<typeof RulebookRulesSchema>;
export type RulePreset = "solo" | "agency" | "collective" | "custom";
export type RulebookSpec = { preset: RulePreset; rules: RulebookRules };

// The json-render catalog: one card per rule family plus the rulebook container.
const rulebookJsonSchema = defineSchema((s) => ({
  spec: s.object({
    root: s.string(),
    elements: s.record(
      s.object({
        type: s.ref("catalog.components"),
        props: s.propsOf("catalog.components"),
        children: s.array(s.string()),
      }),
    ),
  }),
  catalog: s.object({
    components: s.map({ props: s.zod(), description: s.string() }),
  }),
}));

export const RULEBOOK_CATALOG = defineCatalog(rulebookJsonSchema, {
  components: {
    Rulebook: {
      props: z.strictObject({ preset: z.enum(["solo", "agency", "collective", "custom"]) }),
      description: "The team's rulebook: a versioned set of working rules shown as cards.",
    },
    UpfrontPaymentRule: {
      props: upfrontRuleSchema,
      description: "The share of the price paid upfront; a tier rule can vary it by quote size.",
    },
    UpfrontTierRule: {
      props: upfrontTierSchema,
      description: "A different upfront rate for quotes in a size range.",
    },
    RevisionsRule: {
      props: revisionsRuleSchema,
      description: "Free revision rounds, and the price of each revision beyond them.",
    },
    ResponseWindowRule: {
      props: responseWindowRuleSchema,
      description: "How long the team has to answer a new request before it expires.",
    },
    UpdateWindowRule: {
      props: updateWindowRuleSchema,
      description: "How often working members must post an update on the project.",
    },
    ClientSilenceRule: {
      props: clientSilenceRuleSchema,
      description: "The review ladder after delivery, and what happens if the client stays silent.",
    },
    LateDeliveryRule: {
      props: lateDeliveryRuleSchema,
      description: "The refund proposed per day of late delivery, capped.",
    },
    QualityRefundRule: {
      props: qualityRefundRuleSchema,
      description: "Ceilings on refunds for quality issues in each phase of the work.",
    },
    SplitRule: {
      props: splitRuleSchema,
      description: "How the price splits between the team, the manager and the member.",
    },
    StrikesRule: {
      props: strikesRuleSchema,
      description: "How many marks in a rolling window suspend a member from new requests.",
    },
    LeavingNoticeRule: {
      props: leavingNoticeRuleSchema,
      description: "How many days of notice a member gives before leaving.",
    },
    DisputeRule: {
      props: disputeRuleSchema,
      description: "The discussion, review and decision windows of the dispute steps.",
    },
  },
});

// Rule keys and their catalog cards. The tier rule repeats: one card per tier, keyed `upfrontTiers.<n>`.
export const RULE_CARDS = [
  { key: "upfront", component: "UpfrontPaymentRule", repeated: false },
  { key: "upfrontTiers", component: "UpfrontTierRule", repeated: true },
  { key: "revisions", component: "RevisionsRule", repeated: false },
  { key: "responseWindow", component: "ResponseWindowRule", repeated: false },
  { key: "updateWindow", component: "UpdateWindowRule", repeated: false },
  { key: "clientSilence", component: "ClientSilenceRule", repeated: false },
  { key: "lateDelivery", component: "LateDeliveryRule", repeated: false },
  { key: "qualityRefund", component: "QualityRefundRule", repeated: false },
  { key: "split", component: "SplitRule", repeated: false },
  { key: "strikes", component: "StrikesRule", repeated: false },
  { key: "leavingNotice", component: "LeavingNoticeRule", repeated: false },
  { key: "dispute", component: "DisputeRule", repeated: false },
] as const;

const cardByComponent = new Map<string, (typeof RULE_CARDS)[number]>(RULE_CARDS.map((card) => [card.component, card]));

type UpfrontTier = z.output<typeof upfrontTierSchema>;
// The props a spec element can carry: one rule family's value, a single tier, or the rulebook preset.
type RuleElementProps = RulebookRules[keyof RulebookRules] | UpfrontTier | { preset: RulePreset };

export function rulebookToSpec(rulebook: RulebookRules, preset: RulePreset = "custom"): Spec {
  const children: string[] = [];
  const elements: Record<string, { type: string; props: RuleElementProps; children: string[] }> = {};
  for (const card of RULE_CARDS) {
    if (card.repeated) {
      const tiers = rulebook.upfrontTiers.tiers;
      for (const [index, tier] of tiers.entries()) {
        const key = `${card.key}.${index}`;
        elements[key] = { type: card.component, props: tier, children: [] };
        children.push(key);
      }
    } else {
      elements[card.key] = { type: card.component, props: rulebook[card.key], children: [] };
      children.push(card.key);
    }
  }
  elements.root = { type: "Rulebook", props: { preset }, children };
  return { root: "root", elements };
}

export function specToRulebook(spec: Spec): RulebookRules {
  const rules: Partial<RulebookRules> = {};
  const tiers: UpfrontTier[] = [];
  for (const key of spec.elements[spec.root]?.children ?? []) {
    const element = spec.elements[key];
    if (!element) continue;
    if (element.type === "UpfrontTierRule") {
      tiers.push(upfrontTierSchema.parse(element.props));
      continue;
    }
    const card = cardByComponent.get(element.type);
    if (card) {
      // SAFETY: the card key never names upfrontTiers (tier cards continue above); the props bag is
      // re-validated whole by RulebookRulesSchema.parse below before it leaves this function.
      rules[card.key as Exclude<(typeof RULE_CARDS)[number]["key"], "upfrontTiers">] = element.props as never;
    }
  }
  rules.upfrontTiers = { tiers };
  return RulebookRulesSchema.parse(rules);
}
