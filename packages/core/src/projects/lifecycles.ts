import { defineMachine } from "../state-machines/machine";
import {
  AMENDMENT_STATUSES,
  DELIVERY_STATUSES,
  PAYMENT_STATUSES,
  PROJECT_REFUND_PART_STATUSES,
  PROJECT_REFUND_STATUSES,
  QUOTE_STATUSES,
} from "./quotes";

// The lifecycles of a project's own rows. The project's status is projects/state-machine.ts; these move inside the
// same transaction as the project change, which the project's version compare-and-set serialises.

export const quoteMachine = defineMachine({
  name: "quote",
  states: QUOTE_STATUSES,
  initial: "proposed",
  transitions: {
    accept: { from: ["proposed"], to: "accepted" },
    // The other proposed quotes lose when one is accepted; an accepted amendment replaces the current quote with a new
    // version, inserted as accepted.
    supersede: { from: ["proposed", "accepted"], to: "superseded" },
  },
});
export type QuoteEvent = (typeof quoteMachine.events)[number];

export const amendmentMachine = defineMachine({
  name: "amendment",
  states: AMENDMENT_STATUSES,
  initial: "pending",
  transitions: {
    accept: { from: ["pending"], to: "accepted" },
    decline: { from: ["pending"], to: "declined" },
  },
});
export type AmendmentEvent = (typeof amendmentMachine.events)[number];

export const deliveryMachine = defineMachine({
  name: "delivery",
  states: DELIVERY_STATUSES,
  initial: "submitted",
  transitions: {
    accept: { from: ["submitted"], to: "accepted" },
    request_changes: { from: ["submitted"], to: "changes_requested" },
  },
});
export type DeliveryEvent = (typeof deliveryMachine.events)[number];

// A failed capture keeps the payment payable: the client starts a new PayPal order on it. A partial refund leaves the
// payment captured.
export const paymentMachine = defineMachine({
  name: "payment",
  states: PAYMENT_STATUSES,
  initial: "pending",
  transitions: {
    start_order: { from: ["pending", "failed"], to: "pending" },
    capture_completed: { from: ["pending", "failed"], to: "captured" },
    capture_failed: { from: ["pending", "failed"], to: "failed" },
    refund_in_full: { from: ["captured"], to: "refunded" },
    // The project ended without it (abandoned after the client went silent): nothing is owed, so nothing can be paid.
    cancel: { from: ["pending", "failed"], to: "cancelled" },
  },
});
export type PaymentEvent = (typeof paymentMachine.events)[number];

// A refund owed to the client after completion, paid back in parts, one per captured payment.
export const projectRefundMachine = defineMachine({
  name: "project_refund",
  states: PROJECT_REFUND_STATUSES,
  initial: "requested",
  transitions: {
    // Staff send it, or retry it; an issuing refund is retried only while a part is unconfirmed or unsent.
    issue: { from: ["requested", "issuing", "failed"], to: "issuing" },
    refuse: { from: ["requested", "issuing", "failed"], to: "failed" },
    // Every part confirmed, including a refund whose earlier attempt PayPal refused.
    complete: { from: ["requested", "issuing", "failed"], to: "completed" },
  },
});
export type ProjectRefundEvent = (typeof projectRefundMachine.events)[number];

export const projectRefundPartMachine = defineMachine({
  name: "project_refund_part",
  states: PROJECT_REFUND_PART_STATUSES,
  initial: "pending",
  transitions: {
    // A retry, or PayPal's answer naming the refund it holds.
    resend: { from: ["pending", "failed"], to: "pending" },
    complete: { from: ["pending", "failed"], to: "completed" },
    fail: { from: ["pending", "failed"], to: "failed" },
  },
});
export type ProjectRefundPartEvent = (typeof projectRefundPartMachine.events)[number];
