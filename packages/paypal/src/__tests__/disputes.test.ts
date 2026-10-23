import { describe, expect, it } from "vitest";

import { DISPUTE_WEBHOOK_EVENT_TYPES, parseDecimalToMinorUnits, parseDisputeWebhookEvent } from "../index";

const CREATED = {
  id: "WH-D1",
  event_type: "CUSTOMER.DISPUTE.CREATED",
  resource_type: "dispute",
  resource: {
    dispute_id: "PP-D-1234",
    reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    status: "OPEN",
    dispute_state: "OPEN_INQUIRY",
    dispute_amount: { currency_code: "USD", value: "120.50" },
    disputed_transactions: [
      { seller_transaction_id: "9XY10542SP9056731", buyer_transaction_id: "7XY10542SP9056730" },
      { seller_transaction_id: "8XY10542SP9056721" },
    ],
    dispute_life_cycle_stage: "INQUIRY",
  },
};

describe("parseDecimalToMinorUnits", () => {
  it("converts a PayPal decimal string to integer minor units", () => {
    expect(parseDecimalToMinorUnits("120.50")).toBe(12050);
    expect(parseDecimalToMinorUnits("0.05")).toBe(5);
    expect(parseDecimalToMinorUnits("2000")).toBe(200000);
    expect(parseDecimalToMinorUnits("0.00")).toBe(0);
  });

  it("rejects values with more than two decimals or not plain decimal strings", () => {
    expect(parseDecimalToMinorUnits("1.999")).toBeNull();
    expect(parseDecimalToMinorUnits("1,200.00")).toBeNull();
    expect(parseDecimalToMinorUnits("")).toBeNull();
    expect(parseDecimalToMinorUnits("twelve dollars")).toBeNull();
  });
});

describe("parseDisputeWebhookEvent", () => {
  it("parses a CUSTOMER.DISPUTE.CREATED payload with minor units and seller transaction ids", () => {
    expect(parseDisputeWebhookEvent(CREATED)).toEqual({
      id: "WH-D1",
      eventType: "CUSTOMER.DISPUTE.CREATED",
      disputeId: "PP-D-1234",
      reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
      status: "OPEN",
      disputeState: "OPEN_INQUIRY",
      amountMinor: 12050,
      currency: "USD",
      sellerTransactionIds: ["9XY10542SP9056731", "8XY10542SP9056721"],
      buyerTransactionIds: ["7XY10542SP9056730"],
      lifeCycleStage: "INQUIRY",
      outcomeCode: null,
    });
  });

  it("parses an UPDATED event waiting on the seller", () => {
    const event = parseDisputeWebhookEvent({
      id: "WH-D2",
      event_type: "CUSTOMER.DISPUTE.UPDATED",
      resource: {
        dispute_id: "PP-D-1234",
        reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
        status: "WAITING_FOR_SELLER_RESPONSE",
        dispute_amount: { currency_code: "USD", value: "120.50" },
        disputed_transactions: [{ seller_transaction_id: "9XY10542SP9056731", buyer_transaction_id: "7XY10542SP9056730" }],
        dispute_life_cycle_stage: "CHARGEBACK",
      },
    });
    expect(event).toMatchObject({ eventType: "CUSTOMER.DISPUTE.UPDATED", status: "WAITING_FOR_SELLER_RESPONSE", lifeCycleStage: "CHARGEBACK" });
  });

  it("reads a RESOLVED event's outcome code", () => {
    const event = parseDisputeWebhookEvent({
      id: "WH-D3",
      event_type: "CUSTOMER.DISPUTE.RESOLVED",
      resource: {
        dispute_id: "PP-D-1234",
        status: "RESOLVED",
        dispute_amount: { currency_code: "USD", value: "120.50" },
        disputed_transactions: [{ seller_transaction_id: "9XY10542SP9056731" }],
        dispute_life_cycle_stage: "CHARGEBACK",
        dispute_outcome: { outcome_code: "RESOLVED_SELLER_FAVOUR", outcome_reason: "EVIDENCE_REQUIRED" },
      },
    });
    expect(event).toMatchObject({ eventType: "CUSTOMER.DISPUTE.RESOLVED", status: "RESOLVED", outcomeCode: "RESOLVED_SELLER_FAVOUR" });
  });

  it("reads a dispute leniently when transactions, amount or outcome are missing or unreadable", () => {
    expect(
      parseDisputeWebhookEvent({
        id: "WH-D4",
        event_type: "CUSTOMER.DISPUTE.CREATED",
        resource: { dispute_id: "PP-D-5678", status: "OPEN", disputed_transactions: "not-a-list", dispute_amount: { currency_code: "USD" } },
      }),
    ).toEqual({
      id: "WH-D4",
      eventType: "CUSTOMER.DISPUTE.CREATED",
      disputeId: "PP-D-5678",
      reason: null,
      status: "OPEN",
      disputeState: null,
      amountMinor: null,
      currency: null,
      sellerTransactionIds: [],
      buyerTransactionIds: [],
      lifeCycleStage: null,
      outcomeCode: null,
    });
  });

  it("rejects events that are not dispute events", () => {
    expect(
      parseDisputeWebhookEvent({ id: "WH-1", event_type: "PAYMENT.CAPTURE.COMPLETED", resource_type: "capture", resource: { id: "C1" } }),
    ).toBeNull();
  });

  it("rejects malformed payloads", () => {
    expect(parseDisputeWebhookEvent({ event_type: "CUSTOMER.DISPUTE.CREATED", resource: { dispute_id: "PP-D-1" } })).toBeNull();
    expect(parseDisputeWebhookEvent({ id: "WH-D5", event_type: "CUSTOMER.DISPUTE.CREATED" })).toBeNull();
    expect(parseDisputeWebhookEvent({ id: "WH-D6", event_type: "CUSTOMER.DISPUTE.CREATED", resource: { reason: "OTHER" } })).toBeNull();
    expect(parseDisputeWebhookEvent("nope")).toBeNull();
  });

  it("lists exactly the three dispute webhook event types", () => {
    expect(DISPUTE_WEBHOOK_EVENT_TYPES).toEqual(["CUSTOMER.DISPUTE.CREATED", "CUSTOMER.DISPUTE.UPDATED", "CUSTOMER.DISPUTE.RESOLVED"]);
  });
});
