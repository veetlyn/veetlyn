# @opmodel/engine-rules

The rule engine of a team operating model: a typed, versioned rulebook (`RulebookRules`) with twelve rule families, validated by [zod](https://zod.dev) and rendered as a [@json-render/core](https://www.npmjs.com/package/@json-render/core) catalog of rule cards. Pure functions only — no I/O, no platform code, MIT.

## Install

```bash
npm install @opmodel/engine-rules zod @json-render/core
```

## Quickstart

```typescript
import {
  AGENCY_RULEBOOK_SPEC,
  RulebookRulesSchema,
  computeCompletionSplit,
  computeUpfrontBps,
  formatClientTermsSummary,
  formatCompactRuleSummary,
  rulebookToSpec,
  specToRulebook,
} from "@opmodel/engine-rules";

const rules = AGENCY_RULEBOOK_SPEC.rules;

// Upfront rate for a quote, tiers included.
computeUpfrontBps(rules, 20_000); // 10000 (small quotes pay fully upfront)
computeUpfrontBps(rules, 120_000); // 5000

// Exact three-way split of a completion price (integer minor units).
computeCompletionSplit(rules, 100_000, true); // { teamCutMinor: 20000, managerCutMinor: 10000, memberShareMinor: 70000 }

// Plain-English documents and the one-line card summary.
formatClientTermsSummary(rules, "USD");
formatCompactRuleSummary(rules, "USD"); // "50% upfront · 2 free revisions ($75.00 each after) · 14-day review window"

// Store the rulebook as a json-render spec and read it back.
const spec = rulebookToSpec(rules, "agency");
RulebookRulesSchema.parse(specToRulebook(spec)); // === rules
```

## What is in a rulebook

`upfront` + `upfrontTiers`, `revisions`, `responseWindow`, `updateWindow`, `clientSilence`, `lateDelivery`, `qualityRefund`, `split`, `strikes`, `leavingNotice`, `dispute`. Each family has its own zod schema (exported) and its own card in `RULEBOOK_CATALOG`. `SOLO_RULEBOOK_SPEC`, `AGENCY_RULEBOOK_SPEC` and `COLLECTIVE_RULEBOOK_SPEC` seed the three team kinds; edit and re-validate with `RulebookRulesSchema`.

Also exported: `computeLateDeliveryRefundProposal` (a proposal — a person confirms before money moves) and `checkQualityRefundCap` (phase ceilings on quality refunds).

All money is integer minor units; all rates are basis points; splits sum to the price exactly.
