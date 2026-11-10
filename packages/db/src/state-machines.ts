import {
  agentProposalMachine,
  machineDiagram,
  PROJECT_STATUSES,
  PROJECT_TRANSITIONS,
  amendmentMachine,
  defineMachine,
  deliveryMachine,
  disputeMachine,
  type Machine,
  orderMachine,
  paymentMachine,
  payoutRequestMachine,
  paypalOnboardingMachine,
  paypalWebhookEventMachine,
  productMachine,
  projectRefundMachine,
  projectRefundPartMachine,
  quoteMachine,
  rulebookMachine,
  sellerPageMachine,
} from "@jendal-workspace/core";
import { DELIVERY_LIFECYCLE } from "@opmodel/engine-outbox";
import { SCHEDULE_ITEM_LIFECYCLE } from "@opmodel/engine-scheduler";

// Every stored status and the machine that owns it: the one place to read how a row may move. The project's own
// status has guards that need facts beyond the status, so it lives in core's projects/state-machine.ts and is listed
// apart in the docs.

export type StatusMachineEntry = {
  table: string;
  // Read only: the registry lists a machine's table and never moves a row, so its states and events read as strings.
  machine: Machine<string, string>;
  // Where its moves are written: the functions that change the status in a guarded update.
  writers: string;
};

const scheduleItemMachine = defineMachine(SCHEDULE_ITEM_LIFECYCLE);
const outboxDeliveryMachine = defineMachine(DELIVERY_LIFECYCLE);

export const STATUS_MACHINES: readonly StatusMachineEntry[] = [
  { table: "payout_request", machine: payoutRequestMachine, writers: "db/repositories/payout-requests.ts transitionPayoutRequest" },
  { table: "payment", machine: paymentMachine, writers: "api/use-cases/payments.ts, db/repositories/projects.ts addPaymentRefunded" },
  { table: "project_refund", machine: projectRefundMachine, writers: "db/repositories/project-refunds.ts" },
  { table: "project_refund_part", machine: projectRefundPartMachine, writers: "db/repositories/project-refunds.ts" },
  { table: "quote", machine: quoteMachine, writers: "api/use-cases/projects.ts acceptQuote, acceptAmendment" },
  { table: "amendment", machine: amendmentMachine, writers: "api/use-cases/projects.ts acceptAmendment, declineAmendment" },
  { table: "delivery", machine: deliveryMachine, writers: "api/use-cases/projects.ts requestChanges, settleDelivery" },
  { table: "orders", machine: orderMachine, writers: "db/repositories/orders.ts markOrderPaid, markOrderRefunded" },
  { table: "dispute", machine: disputeMachine, writers: "api/use-cases/disputes.ts applyDispute (disputeStatusAfter)" },
  { table: "agent_call_entry", machine: agentProposalMachine, writers: "db/repositories/calls.ts claimPendingProposal, recordProposalOutcome" },
  { table: "paypal_webhook_event", machine: paypalWebhookEventMachine, writers: "db/repositories/paypal-webhooks.ts" },
  { table: "paypal_onboarding", machine: paypalOnboardingMachine, writers: "db/repositories/paypal-onboarding.ts (mirrors PayPal)" },
  { table: "team", machine: sellerPageMachine, writers: "db/repositories/stores.ts setTeamStatus" },
  { table: "products", machine: productMachine, writers: "db/repositories/catalog.ts setProductStatus" },
  { table: "rulebook", machine: rulebookMachine, writers: "db/repositories/operating-model.ts saveRulebookDraft, publishRulebook" },
  { table: "schedule_item", machine: scheduleItemMachine, writers: "oss/engine-drizzle reconcile/complete/setSchedulePaused rows" },
  { table: "outbox_delivery", machine: outboxDeliveryMachine, writers: "db/repositories/operating-model.ts applyDeliveryOutcome, skipOutboxDelivery" },
];

// Status columns no app code moves, with the reason. A new status column must be added to one of the two lists.
export const UNMANAGED_STATUS_COLUMNS = {
  project: "core projects/state-machine.ts (guards need facts beyond the status)",
  agent_call: "a thread stays open so its person can come back to it; `done` is kept for archiving, which is not built",
  invitation: "Better Auth's organization plugin owns it",
  store_domains: "no code writes it yet",
} as const satisfies Record<string, string>;

function projectDiagram(): string {
  const lines = ["stateDiagram-v2", "  [*] --> quoting"];
  for (const [event, rule] of Object.entries(PROJECT_TRANSITIONS)) {
    // The target can depend on the balance still due; both outcomes are drawn.
    const targets = new Set([rule.to({ pendingAmendment: false, unpaidTopUp: false, balanceDueMinor: 1 }), rule.to({ pendingAmendment: false, unpaidTopUp: false, balanceDueMinor: 0 })]);
    for (const from of rule.from) {
      for (const to of targets) lines.push(`  ${from} --> ${to === "unchanged" ? from : to}: ${event}${"guard" in rule ? " [guarded]" : ""}`);
    }
  }
  const terminal = PROJECT_STATUSES.filter((status) => !Object.values(PROJECT_TRANSITIONS).some((rule) => rule.from.some((from) => from === status)));
  for (const status of terminal) lines.push(`  ${status} --> [*]`);
  return lines.join("\n");
}

function section(title: string, body: string[]): string {
  return [`## ${title}`, "", ...body].join("\n");
}

// docs/state-machines.md, rendered from the tables above; a test keeps the file in step with the code.
export function renderStateMachinesDoc(): string {
  const intro = [
    "# State machines",
    "",
    "Generated from `packages/db/src/state-machines.ts` by its test: run `pnpm exec vitest run packages/db/src/state-machines.test.ts -u` after changing a machine. Do not edit by hand.",
    "",
    "Every stored status moves only by a row of its machine. Code changes a status through the machine (`transitionOrThrow`, `machine.transitions[event].to`) and guards the update with `startsFrom` (`packages/db/src/state-guard.ts`), so a stale or concurrent writer cannot skip a step or leave a final state. Checks that need more than the status (an unconfirmed send, a dispute hold) stay in the use case, before the move.",
    "",
    "To add a status or a move: change the machine in `packages/core` (or the engine's lifecycle in `packages/oss`), then the schema enum follows from it.",
  ];
  const project = section("project", [
    "Owner: `packages/core/src/projects/state-machine.ts` (`transitionProject`, `allowedProjectEvents`, `projectAllows`). Guarded moves also need facts: a pending amendment, an unpaid top-up, the balance due.",
    "",
    "```mermaid",
    projectDiagram(),
    "```",
  ]);
  const machines = STATUS_MACHINES.map(({ table, machine, writers }) =>
    section(machine.name, [
      `Table \`${table}\`. Written by ${writers}.`,
      "",
      `| Event | From | To |`,
      `| --- | --- | --- |`,
      ...Object.entries(machine.transitions).map(([event, rule]) => `| \`${event}\` | ${rule.from.map((from) => `\`${from}\``).join(", ")} | \`${rule.to}\` |`),
      "",
      `Final: ${machine.terminal.map((state) => `\`${state}\``).join(", ") || "none"}.${machine.unreachable.length > 0 ? ` Never entered: ${machine.unreachable.map((state) => `\`${state}\``).join(", ")}.` : ""}`,
      "",
      "```mermaid",
      machineDiagram(machine),
      "```",
    ]),
  );
  const billing = section("billing (derived, not stored)", [
    "Owner: `packages/core/src/billing/entitlements.ts` (`entitlementsFor`). A workspace's billing state is computed on every read from its trial end and the Polar subscription mirrored on `billing_account` (`polar_status` copies Polar and is never set by the app). Only `lapsed` stops new sales: paid work, deliveries and refunds always complete.",
    "",
    "```mermaid",
    "stateDiagram-v2",
    "  [*] --> trial: first team created",
    "  trial --> active: checkout (Polar active)",
    "  trial --> grace: 14 days, no checkout",
    "  grace --> active: checkout or payment recovered",
    "  grace --> lapsed: 2 days later",
    "  active --> grace: renewal failed (past_due)",
    "  active --> lapsed: cancelled, period ended, or unpaid/paused",
    "  lapsed --> active: new checkout",
    "```",
  ]);
  const unmanaged = section("Status columns without a machine here", Object.entries(UNMANAGED_STATUS_COLUMNS).map(([table, why]) => `- \`${table}\`: ${why}.`));
  return [...intro, "", project, "", ...machines.flatMap((m) => [m, ""]), billing, "", unmanaged, ""].join("\n");
}
