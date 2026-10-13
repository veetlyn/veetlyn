import type { z } from "zod";

import type { PayPalRequest } from "./client";
import { payoutBatchCreatedSchema, payoutBatchSchema, type payoutMoneySchema } from "./schemas";

export type PayoutMoney = z.output<typeof payoutMoneySchema>;

export type CreatePayoutInput = {
  // PayPal rejects a sender_batch_id reused within 30 days, and pays a retried one once.
  senderBatchId: string;
  requestId: string;
  emailSubject: string;
  item: { receiverPayerId: string; amount: PayoutMoney; note: string; senderItemId: string };
};

export type PayoutBatchCreated = { batchId: string; batchStatus: string };

export type PayoutItem = {
  itemId: string;
  // Missing while PayPal has not processed the item yet.
  status?: string;
  fee?: PayoutMoney;
  senderItemId?: string;
  error?: { name: string; message: string };
};

export type PayoutBatch = { batchId: string; batchStatus: string; items: PayoutItem[] };

export function createPayouts(request: PayPalRequest) {
  return {
    async create(input: CreatePayoutInput): Promise<PayoutBatchCreated> {
      const body = await request(
        {
          method: "POST",
          path: "/v1/payments/payouts",
          requestId: input.requestId,
          retry: false,
          body: {
            sender_batch_header: { sender_batch_id: input.senderBatchId, email_subject: input.emailSubject },
            items: [
              {
                recipient_type: "PAYPAL_ID",
                receiver: input.item.receiverPayerId,
                amount: { value: input.item.amount.value, currency: input.item.amount.currency },
                note: input.item.note,
                sender_item_id: input.item.senderItemId,
              },
            ],
          },
        },
        payoutBatchCreatedSchema,
      );
      return { batchId: body.batch_header.payout_batch_id, batchStatus: body.batch_header.batch_status };
    },

    async getBatch(batchId: string): Promise<PayoutBatch> {
      const body = await request(
        { method: "GET", path: `/v1/payments/payouts/${encodeURIComponent(batchId)}` },
        payoutBatchSchema,
      );
      return {
        batchId: body.batch_header.payout_batch_id,
        batchStatus: body.batch_header.batch_status,
        items: body.items.map((item) => ({
          itemId: item.payout_item_id,
          status: item.transaction_status,
          fee: item.payout_item_fee,
          senderItemId: item.payout_item?.sender_item_id,
          error: item.errors && { name: item.errors.name, message: item.errors.message },
        })),
      };
    },
  };
}
