import { createContext, useContext } from "react";
import { defineRegistry, JSONUIProvider, Renderer } from "@json-render/react";
import { z } from "zod";

import { RULEBOOK_CATALOG, rulebookToSpec, type RulebookRules, type RulebookSpec } from "@opmodel/engine-rules";

import { switchPreset, updateRulebook, type RulebookChanges, type TeamPreset } from "./editor-state";

// Cards edit through this context so the editor owns validation: every change re-validates the whole
// rulebook (updateRulebook) and invalid edits never reach the editor's parent.
type EditContextValue = { edit: (changes: RulebookChanges) => void; currency: string };
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
      <label>
        {field.label}
        <select
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
  return (
    <label>
      {field.label}
      <input
        type="number"
        min={0}
        step={inMajorUnits ? 0.01 : 1}
        value={inMajorUnits ? number / 100 : number}
        disabled={!meta.editable || !context}
        onChange={(event) => {
          const parsed = z.coerce.number().nonnegative().catch(0).parse(event.target.value);
          context?.edit({ [meta.ruleKey]: { [field.prop]: inMajorUnits ? Math.round(parsed * 100) : Math.round(parsed) } });
        }}
      />
      {inMajorUnits && context ? <span>{context.currency}</span> : null}
    </label>
  );
}

function ruleCard(meta: CardMeta) {
  return function RuleCard({ props }: { props: Record<string, CardPropValue> }) {
    return (
      <fieldset className="opm-rule-card" data-rule={meta.ruleKey}>
        <legend>{meta.title}</legend>
        {meta.fields.map((field) => (
          <FieldInput key={field.prop} meta={meta} field={field} value={props[field.prop] ?? null} />
        ))}
      </fieldset>
    );
  };
}

const { registry } = defineRegistry(RULEBOOK_CATALOG, {
  components: {
    Rulebook: ({ children }) => <div className="opm-rulebook">{children}</div>,
    UpfrontPaymentRule: ruleCard(CARD_META.UpfrontPaymentRule),
    UpfrontTierRule: ruleCard(CARD_META.UpfrontTierRule),
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
  onPublish: () => void;
  publishDisabled?: boolean;
};

// The dash rules page: preset buttons, the twelve rule cards rendered through json-render, and a
// publish action. Any field edit marks the rulebook custom and re-validates it whole.
export function RulebookEditor({ spec, currency, onChange, onPublish, publishDisabled = false }: RulebookEditorProps) {
  const edit = (changes: RulebookChanges) => onChange({ preset: "custom", rules: updateRulebook(spec.rules, changes) });
  return (
    <EditContext.Provider value={{ edit, currency }}>
      <div className="opm-rulebook-editor">
        <div className="opm-presets" role="group" aria-label="Preset">
          {TEAM_PRESETS.map((preset) => (
            <button key={preset} type="button" aria-pressed={spec.preset === preset} onClick={() => onChange(switchPreset(preset))}>
              {preset === "solo" ? "Solo" : preset === "agency" ? "Agency" : "Collective"}
            </button>
          ))}
        </div>
        <JSONUIProvider registry={registry}>
          <Renderer spec={rulebookToSpec(spec.rules, spec.preset)} registry={registry} />
        </JSONUIProvider>
        <button type="button" className="opm-publish" disabled={publishDisabled} onClick={onPublish}>
          Publish new version
        </button>
      </div>
    </EditContext.Provider>
  );
}
