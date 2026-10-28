import { useState } from "react";

import { clientTermsLines, formatCompactRuleSummary, memberAgreementLines, type RulebookRules } from "@opmodel/engine-rules";

export type SummaryTab = "client" | "member" | "compact";

const TABS: { key: SummaryTab; label: string }[] = [
  { key: "client", label: "Client terms" },
  { key: "member", label: "Member agreement" },
  { key: "compact", label: "Compact card summary" },
];

export type RulebookSummaryViewProps = {
  rules: RulebookRules;
  currency: string;
  version?: number;
  initialTab?: SummaryTab;
  // Which summaries to offer; readers of a published agreement do not need the card preview.
  tabs?: SummaryTab[];
};

// Live plain-English preview of what the team is about to publish, in the three shapes readers see:
// the client terms, the member agreement and the one-line card summary.
export function RulebookSummaryView({ rules, currency, version, initialTab = "client", tabs }: RulebookSummaryViewProps) {
  const shown = tabs ? tabs.flatMap((key) => TABS.filter((entry) => entry.key === key)) : TABS;
  const [tab, setTab] = useState<SummaryTab>(initialTab);
  const lines =
    tab === "client"
      ? clientTermsLines(rules, currency)
      : tab === "member"
        ? memberAgreementLines(rules, currency)
        : [formatCompactRuleSummary(rules, currency)];
  return (
    <section className="opm-rulebook-summary space-y-3 rounded-lg bg-muted/50 p-4" aria-label="Rulebook preview">
      <header className="space-y-3">
        {version !== undefined ? <h3 className="text-sm font-semibold text-muted-foreground">Version {version}</h3> : null}
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Summary">
          {shown.map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={tab === entry.key}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground aria-selected:bg-accent aria-selected:text-foreground"
              onClick={() => setTab(entry.key)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </header>
      {lines.length === 1 ? (
        <p className="text-sm leading-6">{lines[0]}</p>
      ) : (
        <ul className="list-disc space-y-1.5 pl-5 text-sm leading-6 marker:text-muted-foreground">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
