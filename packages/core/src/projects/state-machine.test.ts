import { describe, expect, it } from "vitest";

import {
  allowedProjectEvents,
  PROJECT_EVENTS,
  PROJECT_STATUSES,
  projectStatusLabel,
  type ProjectEvent,
  type ProjectStatus,
  type TransitionRefusal,
  transitionProject,
  transitionRefusalMessage,
} from "./state-machine";

// Services spec §5.1: the full table, with no pending amendment, no unpaid top-up and a balance due.
const EXPECTED = {
  quoting: {
    add_quote: "quoting",
    assign_freelancer: "quoting",
    accept_quote: "awaiting_deposit",
    cancel: "cancelled",
    decline: "declined",
    expire: "expired",
  },
  awaiting_deposit: { deposit_captured: "in_progress", cancel: "cancelled" },
  in_progress: { submit_delivery: "delivered", propose_amendment: "in_progress", cancel: "cancelled" },
  delivered: {
    request_changes: "in_progress",
    propose_amendment: "delivered",
    accept_delivery: "awaiting_balance",
    auto_complete: "awaiting_balance",
    abandon: "abandoned",
    cancel: "cancelled",
  },
  awaiting_balance: { balance_captured: "completed", abandon: "abandoned", cancel: "cancelled" },
  completed: {},
  cancelled: {},
  declined: {},
  expired: {},
  abandoned: {},
} satisfies Record<ProjectStatus, Partial<Record<ProjectEvent, ProjectStatus>>>;

// Allowed in the status but refused by a guard under the facts used for the table.
const GUARDED = new Map<ProjectStatus, Partial<Record<ProjectEvent, TransitionRefusal>>>([
  ["in_progress", { accept_amendment: "no_pending_amendment", decline_amendment: "no_pending_amendment" }],
  ["delivered", { accept_amendment: "no_pending_amendment", decline_amendment: "no_pending_amendment" }],
]);

describe("project state machine", () => {
  const facts = { pendingAmendment: false, unpaidTopUp: false, balanceDueMinor: 35_000 };

  for (const status of PROJECT_STATUSES) {
    const expected: Partial<Record<ProjectEvent, ProjectStatus>> = EXPECTED[status];
    for (const event of PROJECT_EVENTS) {
      const to = expected[event];
      const reason = GUARDED.get(status)?.[event] ?? "not_allowed_in_status";
      it(`${status} + ${event} → ${to ?? reason}`, () => {
        expect(transitionProject(status, event, facts)).toEqual(to ? { ok: true, to } : { ok: false, reason });
      });
    }
  }

  it("blocks accept delivery while an amendment is pending (§5.5)", () => {
    expect(transitionProject("delivered", "accept_delivery", { pendingAmendment: true, balanceDueMinor: 1 })).toEqual({
      ok: false,
      reason: "pending_amendment",
    });
  });

  it("blocks accept delivery and new amendments while a top-up is unpaid", () => {
    expect(transitionProject("delivered", "accept_delivery", { unpaidTopUp: true })).toEqual({
      ok: false,
      reason: "unpaid_top_up",
    });
    expect(transitionProject("in_progress", "propose_amendment", { unpaidTopUp: true })).toEqual({
      ok: false,
      reason: "unpaid_top_up",
    });
  });

  it("allows one pending amendment at a time and answers only a pending one", () => {
    expect(transitionProject("in_progress", "propose_amendment", { pendingAmendment: true })).toEqual({
      ok: false,
      reason: "pending_amendment",
    });
    expect(transitionProject("in_progress", "accept_amendment", { pendingAmendment: true })).toEqual({
      ok: true,
      to: "in_progress",
    });
    expect(transitionProject("delivered", "decline_amendment", { pendingAmendment: true })).toEqual({
      ok: true,
      to: "delivered",
    });
    expect(transitionProject("in_progress", "accept_amendment")).toEqual({ ok: false, reason: "no_pending_amendment" });
  });

  it("completes on accept delivery when nothing is left to pay (§5.3)", () => {
    expect(transitionProject("delivered", "accept_delivery", { balanceDueMinor: 0 })).toEqual({
      ok: true,
      to: "completed",
    });
  });

  it("lists the events a status allows", () => {
    expect(allowedProjectEvents("quoting")).toEqual([
      "add_quote",
      "assign_freelancer",
      "accept_quote",
      "cancel",
      "decline",
      "expire",
    ]);
    expect(allowedProjectEvents("in_progress", { pendingAmendment: true })).toEqual([
      "submit_delivery",
      "accept_amendment",
      "decline_amendment",
      "cancel",
    ]);
    expect(allowedProjectEvents("completed")).toEqual([]);
  });

  it("explains refusals in plain words", () => {
    expect(transitionRefusalMessage("pending_amendment")).toBe("An amendment is waiting for the client's answer.");
    expect(transitionRefusalMessage("not_allowed_in_status")).toBe(
      "This action is not available at this stage of the project.",
    );
  });
});

describe("projectStatusLabel", () => {
  it("labels every status", () => {
    for (const status of PROJECT_STATUSES) {
      expect(projectStatusLabel(status)).toMatch(/^[A-Z]/);
    }
    expect(projectStatusLabel("awaiting_deposit")).toBe("Awaiting deposit");
  });
});
