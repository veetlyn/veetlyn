import type { PayPalRequest } from "./client";
import type { PayPalMoney, PayPalRefund } from "./orders";
import { refundSchema } from "./schemas";

export type RefundCaptureInput = {
  captureId: string;
  // The seller who received the capture; the refund leaves their account.
  merchantId: string;
  // A stable id makes a retried call return the first refund instead of refunding again.
  requestId: string;
  amount: PayPalMoney;
};

export function createPayments(request: PayPalRequest) {
  return {
    // No payment_instruction: Payleor keeps whatever share of its fee PayPal does not return on its own.
    refundCapture(input: RefundCaptureInput): Promise<PayPalRefund> {
      return request(
        {
          method: "POST",
          path: `/v2/payments/captures/${encodeURIComponent(input.captureId)}/refund`,
          requestId: input.requestId,
          merchantId: input.merchantId,
          prefer: "return=representation",
          body: { amount: input.amount },
        },
        refundSchema,
      );
    },
  };
}
