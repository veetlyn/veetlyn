import { describe, expect, it } from "vitest";

import { createPayPalClient } from "./index";
import type { JsonBody } from "./schemas";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse, recordedAt } from "./testing";

function clientAnswering(status: number, body: JsonBody) {
  const { requests, fetch } = fakeFetch((request) =>
    request.url.endsWith("/v1/oauth2/token") ? jsonResponse(200, FAKE_TOKEN_RESPONSE) : jsonResponse(status, body),
  );
  const client = createPayPalClient({
    clientId: "team-client-id",
    clientSecret: "team-secret",
    environment: "sandbox",
    fetch,
    sleep: () => Promise.resolve(),
  });
  return { client, requests };
}

describe("payouts.create", () => {
  it("sends one PAYPAL_ID item under the sender batch id and reads the batch id", async () => {
    const { client, requests } = clientAnswering(201, {
      batch_header: {
        payout_batch_id: "BATCH1",
        batch_status: "PENDING",
        sender_batch_header: { sender_batch_id: "payout:req-1", email_subject: "You have a payout" },
      },
      links: [],
    });

    const created = await client.payouts.create({
      senderBatchId: "payout:req-1",
      requestId: "payout-send:req-1",
      emailSubject: "You have a payout",
      item: {
        receiverPayerId: "PAYER1",
        amount: { value: "25.00", currency: "USD" },
        note: "Earnings from Acme",
        senderItemId: "req-1",
      },
    });

    expect(created).toEqual({ batchId: "BATCH1", batchStatus: "PENDING" });
    const call = recordedAt(requests, 1);
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://api-m.sandbox.paypal.com/v1/payments/payouts");
    expect(call.headers.get("paypal-request-id")).toBe("payout-send:req-1");
    expect(JSON.parse(call.body ?? "")).toEqual({
      sender_batch_header: { sender_batch_id: "payout:req-1", email_subject: "You have a payout" },
      items: [
        {
          recipient_type: "PAYPAL_ID",
          receiver: "PAYER1",
          amount: { value: "25.00", currency: "USD" },
          note: "Earnings from Acme",
          sender_item_id: "req-1",
        },
      ],
    });
  });
});

describe("payouts.getBatch", () => {
  it("reads each item's status, fee and error, keeping an item whose fee is unreadable", async () => {
    const { client, requests } = clientAnswering(200, {
      batch_header: { payout_batch_id: "BATCH1", batch_status: "SUCCESS" },
      items: [
        {
          payout_item_id: "ITEM1",
          transaction_id: "TX1",
          transaction_status: "SUCCESS",
          payout_item_fee: { currency: "USD", value: "0.25" },
          payout_item: { amount: { currency: "USD", value: "25.00" }, receiver: "PAYER1", sender_item_id: "req-1" },
        },
        {
          payout_item_id: "ITEM2",
          transaction_status: "FAILED",
          payout_item: { amount: { currency: "USD", value: "5.00" }, receiver: "PAYER2", sender_item_id: "req-2" },
          errors: { name: "RECEIVER_UNREGISTERED", message: "Receiver is unregistered" },
        },
        {
          payout_item_id: "ITEM3",
          transaction_status: "SUCCESS",
          payout_item_fee: { currency_code: "USD", value: "0.25" },
          payout_item: { sender_item_id: "req-3" },
        },
      ],
    });

    const batch = await client.payouts.getBatch("BATCH1");

    expect(recordedAt(requests, 1).url).toBe("https://api-m.sandbox.paypal.com/v1/payments/payouts/BATCH1");
    expect(batch).toEqual({
      batchId: "BATCH1",
      batchStatus: "SUCCESS",
      items: [
        {
          itemId: "ITEM1",
          status: "SUCCESS",
          fee: { currency: "USD", value: "0.25" },
          senderItemId: "req-1",
          error: undefined,
        },
        {
          itemId: "ITEM2",
          status: "FAILED",
          fee: undefined,
          senderItemId: "req-2",
          error: { name: "RECEIVER_UNREGISTERED", message: "Receiver is unregistered" },
        },
        { itemId: "ITEM3", status: "SUCCESS", fee: undefined, senderItemId: "req-3", error: undefined },
      ],
    });
  });
});
