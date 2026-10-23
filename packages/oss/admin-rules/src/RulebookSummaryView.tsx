import { useState } from "react";

import {
  formatClientTermsSummary,
  formatCompactRuleSummary,
  formatMemberAgreementSummary,
  type RulebookRules,
} from "@opmodel/engine-rules";

type SummaryTab = "client" | "member" | "compact";

const TABS: { key: SummaryTab; label: string }[] = [
  { key: "client", label: "Client terms" },
  { key: "member", label: "Member agreement" },
  { key: "compact", label: "Compact card summary" },
];

export type RulebookSummaryViewProps = {
  rules: RulebookRules;
  currency: string;
  version?: number;
};

// Live plain-English preview of what the team is about to publish, in the three shapes readers see:
// the client terms, the member agreement and the one-line card summary.
export function RulebookSummaryView({ rules, currency, version }: RulebookSummaryViewProps) {
  const [tab, setTab] = useState<SummaryTab>("client");
  const text =
    tab === "client"
      ? formatClientTermsSummary(rules, currency)
      : tab === "member"
        ? formatMemberAgreementSummary(rules, currency)
        : formatCompactRuleSummary(rules, currency);
  return (
    <section className="opm-rulebook-summary" aria-label="Rulebook preview">
      <header>
        {version !== undefined ? <h3>Version {version}</h3> : null}
        <div role="tablist" aria-label="Summary">
          {TABS.map((entry) => (
            <button key={entry.key} type="button" role="tab" aria-selected={tab === entry.key} onClick={() => setTab(entry.key)}>
              {entry.label}
            </button>
          ))}
        </div>
      </header>
      <p>{text}</p>
    </section>
  );
}
