import type { PayPalRequest } from "./client";

export type PayPalMoney = { currency_code: string; value: string };
export type PayPalCapture = { id: string; status: string; amount?: PayPalMoney; custom_id?: string };
export type PayPalOrder = {
  id: string;
  status: string;
  purchase_units?: { payments?: { captures?: PayPalCapture[] } }[];
};

export type CreateSellerOrderInput = {
  requestId: string;
  // The seller: the order's payee, and the merchant the auth assertion acts for (R1 facts §1).
  merchantId: string;
  currency: string;
  value: string;
  // Payleor's fee as a PayPal amount string; null leaves platform_fees out.
  platformFeeValue: string | null;
  customId: string;
  description: string;
  brandName: string;
};

// PayPal caps description and brand_name at 127 characters (R1 facts §1).
const MAX_TEXT = 127;

function sellerOrderBody(input: Omit<CreateSellerOrderInput, "requestId">) {
  return {
    intent: "CAPTURE",
    purchase_units: [
      {
        custom_id: input.customId,
        description: input.description.slice(0, MAX_TEXT),
        amount: { currency_code: input.currency, value: input.value },
        payee: { merchant_id: input.merchantId },
        ...(input.platformFeeValue === null
          ? {}
          : {
              payment_instruction: {
                disbursement_mode: "INSTANT",
                platform_fees: [{ amount: { currency_code: input.currency, value: input.platformFeeValue } }],
              },
            }),
      },
    ],
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
      return request<PayPalOrder>({
        method: "POST",
        path: "/v2/checkout/orders",
        requestId,
        merchantId: input.merchantId,
        body: sellerOrderBody(order),
      });
    },

    capture(input: { orderId: string; requestId: string; merchantId: string }): Promise<PayPalOrder> {
      return request<PayPalOrder>({
        method: "POST",
        path: `/v2/checkout/orders/${encodeURIComponent(input.orderId)}/capture`,
        requestId: input.requestId,
        merchantId: input.merchantId,
        prefer: "return=representation",
        body: {},
      });
    },

    get(input: { orderId: string; merchantId: string }): Promise<PayPalOrder> {
      return request<PayPalOrder>({
        method: "GET",
        path: `/v2/checkout/orders/${encodeURIComponent(input.orderId)}`,
        merchantId: input.merchantId,
      });
    },
  };
}

// request() casts response bodies without validating them, so each field is checked here.
export function captureFromOrder(order: PayPalOrder): PayPalCapture | null {
  const capture: unknown = order.purchase_units?.[0]?.payments?.captures?.[0];
  if (typeof capture !== "object" || capture === null) return null;
  const record = capture as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.status !== "string") return null;
  const amount = typeof record.amount === "object" && record.amount !== null ? (record.amount as Record<string, unknown>) : null;
  return {
    id: record.id,
    status: record.status,
    amount:
      amount && typeof amount.currency_code === "string" && typeof amount.value === "string"
        ? { currency_code: amount.currency_code, value: amount.value }
        : undefined,
    custom_id: typeof record.custom_id === "string" ? record.custom_id : undefined,
  };
}
