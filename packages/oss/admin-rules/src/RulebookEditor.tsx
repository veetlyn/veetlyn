import { createContext, useContext, useState } from "react";
import { defineRegistry, JSONUIProvider, Renderer } from "@json-render/react";
import { z } from "zod";

import { RULEBOOK_CATALOG, rulebookToSpec, type RulebookRules, type RulebookSpec } from "@opmodel/engine-rules";

import {
  switchPreset,
  updateRulebook,
  updateSplitRule,
  updateUpfrontTier,
  majorUnitsToMinor,
  type RulebookChanges,
  type TeamPreset,
} from "./editor-state";

// Cards edit through this context so the editor owns validation: every change re-validates the whole
// rulebook (updateRulebook) and invalid edits never reach the editor's parent.
type EditContextValue = {
  edit: (changes: RulebookChanges) => void;
  editSplit: (field: keyof RulebookRules["split"], value: number) => void;
  rejectEdit: () => void;
  currency: string;
  rules: RulebookRules;
};
const EditContext = createContext<EditContextValue | null>(null);

type FieldKind = "percent" | "count" | "money" | "hours" | "days" | "outcome";
type CardField = { prop: string; label: string; kind: FieldKind };
type CardMeta = { title: string; ruleKey: keyof RulebookRules & string; fields: CardField[]; editable: boolean };

const CARD_META = {
  UpfrontPaymentRule: { title: "Upfront payment", ruleKey: "upfront", editable: true, fields: [{ prop: "defaultBps", label: "Upfront rate", kind: "percent" }] },
  UpfrontTierRule: {
    title: "Upfront tier",
    ruleKey: "upfrontTiers",
    editable: false,
    fields: [
      { prop: "minQuoteMinor", label: "From quote", kind: "money" },
      { prop: "maxQuoteMinor", label: "Up to quote", kind: "money" },
      { prop: "bps", label: "Rate", kind: "percent" },
    ],
  },
  RevisionsRule: {
    title: "Revisions",
    ruleKey: "revisions",
    editable: true,
    fields: [
      { prop: "freeCount", label: "Free rounds", kind: "count" },
      { prop: "paidRevisionPriceMinor", label: "Paid revision price", kind: "money" },
    ],
  },
  ResponseWindowRule: {
    title: "Response window",
    ruleKey: "responseWindow",
    editable: true,
    fields: [
      { prop: "hours", label: "Reply within (hours)", kind: "hours" },
      { prop: "remindBeforeHours", label: "Reminder before (hours)", kind: "hours" },
    ],
  },
  UpdateWindowRule: {
    title: "Update window",
    ruleKey: "updateWindow",
    editable: true,
    fields: [
      { prop: "hours", label: "Update every (hours)", kind: "hours" },
      { prop: "remindBeforeHours", label: "Reminder before (hours)", kind: "hours" },
    ],
  },
  ClientSilenceRule: {
    title: "Client review",
    ruleKey: "clientSilence",
    editable: true,
    fields: [
      { prop: "firstReminderDays", label: "First reminder (days)", kind: "days" },
      { prop: "secondReminderDays", label: "Second reminder (days)", kind: "days" },
      { prop: "finalDays", label: "Review closes after (days)", kind: "days" },
      { prop: "silenceOutcome", label: "If the client stays silent", kind: "outcome" },
    ],
  },
  LateDeliveryRule: {
    title: "Late-delivery refund",
    ruleKey: "lateDelivery",
    editable: true,
    fields: [
      { prop: "ratePerDayBps", label: "Refund per day late", kind: "percent" },
      { prop: "capBps", label: "Refund cap", kind: "percent" },
    ],
  },
  QualityRefundRule: {
    title: "Quality refund caps",
    ruleKey: "qualityRefund",
    editable: true,
    fields: [
      { prop: "beforeWorkCapBps", label: "Before work starts", kind: "percent" },
      { prop: "inProgressCapBps", label: "During work", kind: "percent" },
      { prop: "afterDeliveryCapBps", label: "After delivery", kind: "percent" },
    ],
  },
  SplitRule: {
    title: "Split",
    ruleKey: "split",
    editable: true,
    fields: [
      { prop: "teamCutBps", label: "Team", kind: "percent" },
      { prop: "managerCutBps", label: "Manager", kind: "percent" },
      { prop: "memberCutBps", label: "Member", kind: "percent" },
    ],
  },
  StrikesRule: {
    title: "Strikes",
    ruleKey: "strikes",
    editable: true,
    fields: [
      { prop: "threshold", label: "Marks before suspension", kind: "count" },
      { prop: "windowDays", label: "Rolling window (days)", kind: "days" },
    ],
  },
  LeavingNoticeRule: { title: "Leaving notice", ruleKey: "leavingNotice", editable: true, fields: [{ prop: "days", label: "Notice (days)", kind: "days" }] },
  DisputeRule: {
    title: "Dispute steps",
    ruleKey: "dispute",
    editable: true,
    fields: [
      { prop: "discussionDays", label: "Discussion (days)", kind: "days" },
      { prop: "reviewDays", label: "Review (days)", kind: "days" },
      { prop: "decisionDays", label: "Decision (days)", kind: "days" },
    ],
  },
} as const satisfies Record<string, CardMeta>;

// Card props arrive as spec JSON, so the card decodes each field at its boundary.
type CardPropValue = number | string | null;
const cardNumber = z.number().catch(0);
const cardText = z.string().catch("");

function FieldInput({ meta, field, value }: { meta: CardMeta; field: CardField; value: CardPropValue }) {
  const context = useContext(EditContext);
  if (field.kind === "outcome") {
    return (
      <label className="grid gap-1 text-sm font-medium">
        {field.label}
        <select
          className="h-10 rounded-md border bg-background px-3 text-sm font-normal"
          value={cardText.parse(value)}
          disabled={!meta.editable || !context}
          onChange={(event) => context?.edit({ [meta.ruleKey]: { silenceOutcome: event.target.value === "abandon" ? "abandon" : "accept_and_complete" } })}
        >
          <option value="accept_and_complete">Accept the delivery and complete</option>
          <option value="abandon">End the project</option>
        </select>
      </label>
    );
  }
  const number = cardNumber.parse(value);
  const inMajorUnits = field.kind === "money";
  const inPercent = field.kind === "percent";
  const unit = inPercent ? "%" : inMajorUnits ? context?.currency : undefined;
  return (
    <label className="grid gap-1 text-sm font-medium">
      {field.label}
      <span className="relative block">
      <input
        type="number"
        min={0}
        max={inPercent ? 100 : undefined}
        step={inMajorUnits || inPercent ? 0.01 : 1}
        value={inMajorUnits || inPercent ? number / 100 : number}
        disabled={!meta.editable || !context}
        className={`h-10 w-full rounded-md border bg-background px-3 text-sm font-normal ${unit ? "pr-14" : ""}`}
        onChange={(event) => {
          const parsed = z.coerce.number().nonnegative().catch(0).parse(event.target.value);
          const decimalValue = inMajorUnits || inPercent ? majorUnitsToMinor(event.target.value) : null;
          if ((inMajorUnits || inPercent) && decimalValue === null) {
            context?.rejectEdit();
            return;
          }
          const valueInRuleUnits = inMajorUnits || inPercent ? decimalValue ?? 0 : Math.round(parsed);
          if (
            meta.ruleKey === "split" &&
            (field.prop === "teamCutBps" || field.prop === "managerCutBps" || field.prop === "memberCutBps")
          ) {
            try {
              context?.editSplit(field.prop, valueInRuleUnits);
            } catch {
              return;
            }
            return;
          }
          context?.edit({ [meta.ruleKey]: { [field.prop]: valueInRuleUnits } });
        }}
      />
      {unit ? (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-normal text-muted-foreground">
          {unit}
        </span>
      ) : null}
      </span>
    </label>
  );
}

// Each rule card is a link target, so a page can list the rules and jump to one.
export function ruleAnchor(ruleKey: string): string {
  return `rule-${ruleKey}`;
}

// The rules in the order the editor shows them, for a page's section list.
export const RULE_SECTIONS: { ruleKey: string; title: string }[] = Object.values(CARD_META)
  .filter((meta) => meta.ruleKey !== "upfrontTiers")
  .map(({ ruleKey, title }) => ({ ruleKey, title }));

function ruleCard(meta: CardMeta) {
  return function RuleCard({ props }: { props: Record<string, CardPropValue> }) {
    return (
      <div
        id={ruleAnchor(meta.ruleKey)}
        role="group"
        aria-labelledby={`${ruleAnchor(meta.ruleKey)}-title`}
        className="opm-rule-card grid scroll-mt-20 content-start gap-3 rounded-lg bg-muted/50 p-4"
        data-rule={meta.ruleKey}
      >
        <h3 id={`${ruleAnchor(meta.ruleKey)}-title`} className="text-sm font-semibold">{meta.title}</h3>
        {meta.fields.map((field) => (
          <FieldInput key={field.prop} meta={meta} field={field} value={props[field.prop] ?? null} />
        ))}
      </div>
    );
  };
}

const { registry } = defineRegistry(RULEBOOK_CATALOG, {
  components: {
    Rulebook: ({ children }) => <div className="opm-rulebook grid gap-3 md:grid-cols-2">{children}</div>,
    UpfrontPaymentRule: ruleCard(CARD_META.UpfrontPaymentRule),
    // Tier controls live below so edits can validate the complete tier list together.
    UpfrontTierRule: () => null,
    RevisionsRule: ruleCard(CARD_META.RevisionsRule),
    ResponseWindowRule: ruleCard(CARD_META.ResponseWindowRule),
    UpdateWindowRule: ruleCard(CARD_META.UpdateWindowRule),
    ClientSilenceRule: ruleCard(CARD_META.ClientSilenceRule),
    LateDeliveryRule: ruleCard(CARD_META.LateDeliveryRule),
    QualityRefundRule: ruleCard(CARD_META.QualityRefundRule),
    SplitRule: ruleCard(CARD_META.SplitRule),
    StrikesRule: ruleCard(CARD_META.StrikesRule),
    LeavingNoticeRule: ruleCard(CARD_META.LeavingNoticeRule),
    DisputeRule: ruleCard(CARD_META.DisputeRule),
  },
});

const TEAM_PRESETS: TeamPreset[] = ["solo", "agency", "collective"];

export type RulebookEditorProps = {
  spec: RulebookSpec;
  currency: string;
  onChange: (next: RulebookSpec) => void;
  // Without it the host page places its own publish control.
  onPublish?: () => void;
  publishDisabled?: boolean;
};

// The dash rules page: presets, rule cards rendered through json-render, editable tiers, and publishing.
// Any field edit marks the rulebook custom and re-validates it whole.
export function RulebookEditor({ spec, currency, onChange, onPublish, publishDisabled = false }: RulebookEditorProps) {
  const [validationMessage, setValidationMessage] = useState("");
  const edit = (changes: RulebookChanges) => {
    try {
      onChange({ preset: "custom", rules: updateRulebook(spec.rules, changes) });
      setValidationMessage("");
    } catch {
      setValidationMessage("That value would make the rulebook invalid. The last valid value is still in place.");
    }
  };
  const editSplit = (field: keyof RulebookRules["split"], value: number) => {
    try {
      edit({ split: updateSplitRule(spec.rules, field, value).split });
    } catch {
      setValidationMessage("Those split amounts must add up to 100%.");
    }
  };
  const updateTier = (index: number, field: "minQuoteMinor" | "maxQuoteMinor" | "bps", value: number | null) => {
    try {
      onChange({
        preset: "custom",
        rules: updateUpfrontTier(spec.rules, index, { [field]: value }),
      });
    } catch {
      setValidationMessage("That tier value would make the rulebook invalid. The last valid value is still in place.");
    }
  };
  return (
    <EditContext.Provider value={{ edit, editSplit, rejectEdit: () => setValidationMessage("Use up to two decimal places and a value within the rule limits."), currency, rules: spec.rules }}>
      <div className="opm-rulebook-editor grid gap-5">
        <div className="opm-presets flex flex-wrap gap-2" role="group" aria-label="Preset">
          {TEAM_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-pressed={spec.preset === preset}
              className="rounded-full border px-4 py-2 text-sm font-medium aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background"
              onClick={() => {
                setValidationMessage("");
                onChange(switchPreset(preset));
              }}
            >
              {preset === "solo" ? "Solo" : preset === "agency" ? "Agency" : "Collective"}
            </button>
          ))}
        </div>
        <JSONUIProvider registry={registry}>
          <Renderer spec={rulebookToSpec(spec.rules, spec.preset)} registry={registry} />
        </JSONUIProvider>
        {validationMessage ? <p role="alert" className="text-sm text-destructive">{validationMessage}</p> : null}
        {spec.rules.upfrontTiers.tiers.length > 0 ? (
          <section id={ruleAnchor("upfrontTiers")} className="mt-5 scroll-mt-20 space-y-3" aria-label="Upfront payment tiers">
            <h3 className="font-medium">Upfront payment tiers</h3>
            <p className="text-sm text-muted-foreground">
              Set the quote range and upfront rate for each tier. Leave the upper amount empty for no limit. When ranges overlap, the first matching tier applies.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {spec.rules.upfrontTiers.tiers.map((tier, index) => (
                <div key={index} role="group" aria-label={`Tier ${index + 1}`} className="grid gap-3 rounded-lg bg-muted/50 p-4">
                  <p className="text-sm font-semibold">Tier {index + 1}</p>
                  <label className="grid gap-1 text-sm">
                    From quote ({currency})
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={tier.minQuoteMinor / 100}
                      onChange={(event) => {
                        const minor = majorUnitsToMinor(event.target.value);
                        if (minor === null) setValidationMessage("Enter a quote amount with no more than two decimal places.");
                        else updateTier(index, "minQuoteMinor", minor);
                      }}
                      className="h-10 rounded-md border bg-background px-3"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    Up to quote ({currency})
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={tier.maxQuoteMinor === null ? "" : tier.maxQuoteMinor / 100}
                      onChange={(event) => {
                        if (event.target.value === "") {
                          updateTier(index, "maxQuoteMinor", null);
                          return;
                        }
                        const minor = majorUnitsToMinor(event.target.value);
                        if (minor === null) setValidationMessage("Enter a quote amount with no more than two decimal places.");
                        else updateTier(index, "maxQuoteMinor", minor);
                      }}
                      className="h-10 rounded-md border bg-background px-3"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    Upfront rate (%)
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={tier.bps / 100}
                      onChange={(event) => {
                        const bps = majorUnitsToMinor(event.target.value);
                        if (bps === null) setValidationMessage("Enter a rate with no more than two decimal places.");
                        else updateTier(index, "bps", bps);
                      }}
                      className="h-10 rounded-md border bg-background px-3"
                    />
                  </label>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        {onPublish ? (
        <button
          type="button"
          className="opm-publish h-10 justify-self-start rounded-md bg-foreground px-4 text-sm font-semibold text-background disabled:cursor-not-allowed disabled:opacity-50"
          disabled={publishDisabled}
          onClick={onPublish}
        >
          Publish new version
        </button>
        ) : null}
      </div>
    </EditContext.Provider>
  );
}
