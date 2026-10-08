import type { PayPalRequest } from "./client";

export type PayPalMoney = { currency_code: string; value: string };
export type PayPalCaptureBreakdown = { paypal_fee?: PayPalMoney; platform_fees: { amount: PayPalMoney }[] };
export type PayPalCapture = {
  id: string;
  status: string;
  amount?: PayPalMoney;
  custom_id?: string;
  create_time?: string;
  // Missing while a capture is pending (R1 facts §2).
  seller_receivable_breakdown?: PayPalCaptureBreakdown;
};
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
  // One line per item, quantity 1, so the buyer's receipt matches the pay page. Their values must add up
  // to `value`; PayPal rejects the order otherwise.
  items?: { name: string; value: string }[];
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
        amount: {
          currency_code: input.currency,
          value: input.value,
          ...(input.items?.length ? { breakdown: { item_total: { currency_code: input.currency, value: input.value } } } : {}),
        },
        ...(input.items?.length
          ? {
              items: input.items.map((item) => ({
                name: item.name.slice(0, MAX_TEXT),
                quantity: "1",
                unit_amount: { currency_code: input.currency, value: item.value },
              })),
            }
          : {}),
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

function parseMoney(value: unknown): PayPalMoney | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const money = value as Record<string, unknown>;
  return typeof money.currency_code === "string" && typeof money.value === "string"
    ? { currency_code: money.currency_code, value: money.value }
    : undefined;
}

// A fee that is present but unreadable makes the whole breakdown unknown: dropping it would later record
// the fee as zero.
function parseBreakdown(value: unknown): PayPalCaptureBreakdown | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const paypalFee = parseMoney(record.paypal_fee);
  if (record.paypal_fee !== undefined && !paypalFee) return undefined;
  if (record.platform_fees !== undefined && !Array.isArray(record.platform_fees)) return undefined;
  const platformFees: { amount: PayPalMoney }[] = [];
  for (const fee of record.platform_fees ?? []) {
    const amount = typeof fee === "object" && fee !== null ? parseMoney((fee as Record<string, unknown>).amount) : undefined;
    if (!amount) return undefined;
    platformFees.push({ amount });
  }
  return { paypal_fee: paypalFee, platform_fees: platformFees };
}

function parseCapture(value: unknown): PayPalCapture | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.status !== "string") return null;
  return {
    id: record.id,
    status: record.status,
    amount: parseMoney(record.amount),
    custom_id: typeof record.custom_id === "string" ? record.custom_id : undefined,
    create_time: typeof record.create_time === "string" ? record.create_time : undefined,
    seller_receivable_breakdown: parseBreakdown(record.seller_receivable_breakdown),
  };
}

// An order with intent CAPTURE holds one capture, but a declined attempt may sit next to a later one, so a
// completed capture wins, then a pending one. request() casts bodies without validating them, so each field is checked.
export function captureFromOrder(order: PayPalOrder): PayPalCapture | null {
  const raw: unknown = order.purchase_units?.[0]?.payments?.captures;
  if (!Array.isArray(raw)) return null;
  const captures = raw.map(parseCapture).filter((capture): capture is PayPalCapture => capture !== null);
  return (
    captures.find((capture) => capture.status === "COMPLETED") ??
    captures.find((capture) => capture.status === "PENDING") ??
    captures[0] ??
    null
  );
}
