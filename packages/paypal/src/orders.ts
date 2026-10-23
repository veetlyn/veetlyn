import type { z } from "zod";

import type { PayPalRequest } from "./client";
import {
  captureBreakdownSchema,
  captureSchema,
  moneySchema,
  orderSchema,
  parsedItems,
  refundBreakdownSchema,
  refundSchema,
} from "./schemas";

export type PayPalMoney = z.output<typeof moneySchema>;
export type PayPalCaptureBreakdown = z.output<typeof captureBreakdownSchema>;
export type PayPalCapture = z.output<typeof captureSchema>;
export type PayPalRefundBreakdown = z.output<typeof refundBreakdownSchema>;
export type PayPalRefund = z.output<typeof refundSchema>;
export type PayPalOrder = z.output<typeof orderSchema>;

export type CreateSellerOrderInput = {
  requestId: string;
  // The seller: the order's payee, and the merchant the auth assertion acts for (R1 facts §1).
  merchantId: string;
  currency: string;
  value: string;
  // The platform's fee as a PayPal amount string; null leaves platform_fees out.
  platformFeeValue: string | null;
  customId: string;
  description: string;
  brandName: string;
  // One line per item, quantity 1, so the buyer's receipt matches the pay page. Their values must add up
  // to `value`; PayPal rejects the order otherwise.
  items?: { name: string; value: string }[];
};

// PayPal caps description and brand_name at 127 characters (R1 facts §1).
const MAX_TEXT = 127;

type OrderItem = { name: string; quantity: string; unit_amount: PayPalMoney };
type OrderPurchaseUnit = {
  custom_id: string;
  description: string;
  amount: PayPalMoney & { breakdown?: { item_total: PayPalMoney } };
  items?: OrderItem[];
  payee: { merchant_id: string };
  payment_instruction?: { disbursement_mode: "INSTANT"; platform_fees: { amount: PayPalMoney }[] };
};

function sellerOrderBody(input: Omit<CreateSellerOrderInput, "requestId">) {
  const unit: OrderPurchaseUnit = {
    custom_id: input.customId,
    description: input.description.slice(0, MAX_TEXT),
    amount: { currency_code: input.currency, value: input.value },
    payee: { merchant_id: input.merchantId },
  };
  if (input.items?.length) {
    unit.amount.breakdown = { item_total: { currency_code: input.currency, value: input.value } };
    unit.items = input.items.map((item) => ({
      name: item.name.slice(0, MAX_TEXT),
      quantity: "1",
      unit_amount: { currency_code: input.currency, value: item.value },
    }));
  }
  if (input.platformFeeValue !== null) {
    unit.payment_instruction = {
      disbursement_mode: "INSTANT",
      platform_fees: [{ amount: { currency_code: input.currency, value: input.platformFeeValue } }],
    };
  }
  return {
    intent: "CAPTURE",
    purchase_units: [unit],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: input.brandName.slice(0, MAX_TEXT),
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
        },
      },
    },
  };
}

export function createOrders(request: PayPalRequest) {
  return {
    create(input: CreateSellerOrderInput): Promise<PayPalOrder> {
      const { requestId, ...order } = input;
      return request(
        {
          method: "POST",
          path: "/v2/checkout/orders",
          requestId,
          merchantId: input.merchantId,
          body: sellerOrderBody(order),
        },
        orderSchema,
      );
    },

    capture(input: { orderId: string; requestId: string; merchantId: string }): Promise<PayPalOrder> {
      return request(
        {
          method: "POST",
          path: `/v2/checkout/orders/${encodeURIComponent(input.orderId)}/capture`,
          requestId: input.requestId,
          merchantId: input.merchantId,
          prefer: "return=representation",
          body: {},
        },
        orderSchema,
      );
    },

    get(input: { orderId: string; merchantId: string }): Promise<PayPalOrder> {
      return request(
        {
          method: "GET",
          path: `/v2/checkout/orders/${encodeURIComponent(input.orderId)}`,
          merchantId: input.merchantId,
        },
        orderSchema,
      );
    },
  };
}

// An order with intent CAPTURE holds one capture, but a declined attempt may sit next to a later one, so a
// completed capture wins, then a pending one. A capture that cannot be read is skipped.
export function captureFromOrder(order: PayPalOrder): PayPalCapture | null {
  const raw = order.purchase_units?.[0]?.payments?.captures;
  if (!raw) return null;
  const captures = parsedItems(captureSchema, raw);
  return (
    captures.find((capture) => capture.status === "COMPLETED") ??
    captures.find((capture) => capture.status === "PENDING") ??
    captures[0] ??
    null
  );
}

// Refunds without an id or a status are dropped.
export function refundsFromOrder(order: PayPalOrder): PayPalRefund[] {
  return parsedItems(refundSchema, order.purchase_units?.[0]?.payments?.refunds ?? []);
}
