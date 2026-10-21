import { describe, expect, it } from "vitest";

import {
  buildAuthAssertion,
  captureFromOrder,
  createPayPalClient,
  type PayPalCaptureBreakdown,
  type PayPalOrder,
  refundsFromOrder,
} from "./index";
import type { JsonBody } from "./schemas";
import { FAKE_TOKEN_RESPONSE, fakeFetch, jsonResponse, recordedAt } from "./testing";

function clientWith(respond: (url: string) => Response) {
  const { requests, fetch } = fakeFetch((request) =>
    request.url.endsWith("/v1/oauth2/token") ? jsonResponse(200, FAKE_TOKEN_RESPONSE) : respond(request.url),
  );
  const client = createPayPalClient({
    clientId: "partner-client-id",
    clientSecret: "partner-secret",
    environment: "sandbox",
    fetch,
    sleep: () => Promise.resolve(),
    partnerAttributionId: "PLATFORM_BN",
  });
  return { client, requests };
}

const ASSERTION = buildAuthAssertion({ clientId: "partner-client-id", payerId: "SELLER1" });

const CAPTURED = {
  id: "ORDER1",
  status: "COMPLETED",
  purchase_units: [
    {
      payments: {
        captures: [{ id: "CAPTURE1", status: "COMPLETED", amount: { currency_code: "USD", value: "600.00" }, custom_id: "pay-1" }],
      },
    },
  ],
} satisfies PayPalOrder;

describe("orders.create", () => {
  it("creates an order for the seller with Payleor's fee", async () => {
    const { client, requests } = clientWith(() => jsonResponse(201, { id: "ORDER1", status: "CREATED" }));

    const order = await client.orders.create({
      requestId: "order:pay-1:abc",
      merchantId: "SELLER1",
      currency: "USD",
      value: "600.00",
      platformFeeValue: "6.00",
      customId: "pay-1",
      description: "Website redesign",
      brandName: "Acme Studio",
    });

    expect(order).toEqual({ id: "ORDER1", status: "CREATED" });
    const call = recordedAt(requests, 1);
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
    expect(call.headers.get("paypal-request-id")).toBe("order:pay-1:abc");
    expect(call.headers.get("paypal-auth-assertion")).toBe(ASSERTION);
    expect(call.headers.get("paypal-partner-attribution-id")).toBe("PLATFORM_BN");
    expect(JSON.parse(call.body ?? "")).toEqual({
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: "pay-1",
          description: "Website redesign",
          amount: { currency_code: "USD", value: "600.00" },
          payee: { merchant_id: "SELLER1" },
          payment_instruction: {
            disbursement_mode: "INSTANT",
            platform_fees: [{ amount: { currency_code: "USD", value: "6.00" } }],
          },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: { brand_name: "Acme Studio", shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW" },
        },
      },
    });
  });

  it("leaves platform_fees out when the fee rounds to nothing, and cuts long texts to 127 characters", async () => {
    const { client, requests } = clientWith(() => jsonResponse(201, { id: "ORDER2", status: "CREATED" }));

    await client.orders.create({
      requestId: "order:pay-2:abc",
      merchantId: "SELLER1",
      currency: "EUR",
      value: "0.01",
      platformFeeValue: null,
      customId: "pay-2",
      description: "d".repeat(200),
      brandName: "b".repeat(200),
    });

    const body = JSON.parse(recordedAt(requests, 1).body ?? "");
    expect(body.purchase_units[0].payment_instruction).toBeUndefined();
    expect(body.purchase_units[0].description).toHaveLength(127);
    expect(body.payment_source.paypal.experience_context.brand_name).toHaveLength(127);
  });

  it("lists the items and their total when given items", async () => {
    const { client, requests } = clientWith(() => jsonResponse(201, { id: "ORDER3", status: "CREATED" }));

    await client.orders.create({
      requestId: "order:pay-3:abc",
      merchantId: "SELLER1",
      currency: "USD",
      value: "180.00",
      platformFeeValue: "1.80",
      customId: "pay-3",
      description: "Landing page",
      brandName: "Walk Crew",
      items: [
        { name: "Deposit (50% of the quote)", value: "150.00" },
        { name: "n".repeat(200), value: "30.00" },
      ],
    });

    const unit = JSON.parse(recordedAt(requests, 1).body ?? "").purchase_units[0];
    expect(unit.amount).toEqual({
      currency_code: "USD",
      value: "180.00",
      breakdown: { item_total: { currency_code: "USD", value: "180.00" } },
    });
    expect(unit.items).toEqual([
      { name: "Deposit (50% of the quote)", quantity: "1", unit_amount: { currency_code: "USD", value: "150.00" } },
      { name: "n".repeat(127), quantity: "1", unit_amount: { currency_code: "USD", value: "30.00" } },
    ]);
  });
});

describe("orders.capture and orders.get", () => {
  it("captures for the seller and asks for the full representation", async () => {
    const { client, requests } = clientWith(() => jsonResponse(201, CAPTURED));

    const order = await client.orders.capture({ orderId: "ORDER1", requestId: "capture:ORDER1:abc", merchantId: "SELLER1" });

    expect(order).toEqual(CAPTURED);
    const call = recordedAt(requests, 1);
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER1/capture");
    expect(call.headers.get("paypal-request-id")).toBe("capture:ORDER1:abc");
    expect(call.headers.get("paypal-auth-assertion")).toBe(ASSERTION);
    expect(call.headers.get("prefer")).toBe("return=representation");
  });

  it("shows an order for the seller", async () => {
    const { client, requests } = clientWith(() => jsonResponse(200, CAPTURED));

    await client.orders.get({ orderId: "ORDER1", merchantId: "SELLER1" });

    const call = recordedAt(requests, 1);
    expect(call.method).toBe("GET");
    expect(call.url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER1");
    expect(call.headers.get("paypal-auth-assertion")).toBe(ASSERTION);
  });
});

describe("captureFromOrder", () => {
  it("reads the first capture of the first purchase unit", () => {
    expect(captureFromOrder(CAPTURED)).toEqual({
      id: "CAPTURE1",
      status: "COMPLETED",
      amount: { currency_code: "USD", value: "600.00" },
      custom_id: "pay-1",
    });
  });

  it("prefers a completed capture over a declined attempt beside it", () => {
    const order: PayPalOrder = {
      id: "ORDER1",
      status: "COMPLETED",
      purchase_units: [
        {
          payments: {
            captures: [
              { id: "C1", status: "DECLINED", amount: { currency_code: "USD", value: "600.00" } },
              { id: "C2", status: "COMPLETED", amount: { currency_code: "USD", value: "600.00" } },
            ],
          },
        },
      ],
    };
    expect(captureFromOrder(order)).toMatchObject({ id: "C2", status: "COMPLETED" });
  });

  it("returns null when the order has no usable capture", () => {
    expect(captureFromOrder({ id: "ORDER1", status: "CREATED" })).toBeNull();
    expect(captureFromOrder({ id: "ORDER1", status: "COMPLETED", purchase_units: [{ payments: { captures: [] } }] })).toBeNull();
    const broken: PayPalOrder = { id: "ORDER1", status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: 7 }] } }] };
    expect(captureFromOrder(broken)).toBeNull();
  });

  it("drops an amount whose fields are not strings", () => {
    const odd: PayPalOrder = {
      id: "ORDER1",
      status: "COMPLETED",
      purchase_units: [{ payments: { captures: [{ id: "C", status: "PENDING", amount: { value: 6 } }] } }],
    };
    expect(captureFromOrder(odd)).toEqual({ id: "C", status: "PENDING", amount: undefined, custom_id: undefined });
  });

  it("reads the capture time and the fee breakdown", () => {
    // As PayPal returns it, with fields PayPalCapture does not keep (gross, the fee's payee).
    const capture = {
      id: "CAPTURE1",
      status: "COMPLETED",
      amount: { currency_code: "USD", value: "120.00" },
      create_time: "2026-10-08T00:28:21Z",
      seller_receivable_breakdown: {
        gross_amount: { currency_code: "USD", value: "120.00" },
        paypal_fee: { currency_code: "USD", value: "4.98" },
        platform_fees: [{ amount: { currency_code: "USD", value: "1.20" }, payee: { merchant_id: "PAYLEOR" } }],
        net_amount: { currency_code: "USD", value: "113.82" },
      },
    };
    const order: PayPalOrder = { id: "ORDER1", status: "COMPLETED", purchase_units: [{ payments: { captures: [capture] } }] };
    expect(captureFromOrder(order)).toMatchObject({
      id: "CAPTURE1",
      create_time: "2026-10-08T00:28:21Z",
      seller_receivable_breakdown: {
        paypal_fee: { currency_code: "USD", value: "4.98" },
        platform_fees: [{ amount: { currency_code: "USD", value: "1.20" } }],
      },
    });
  });

  it("reads a converted receivable, and an unreadable rate leaves the fees intact", () => {
    const converted = (exchangeRate: JsonBody): PayPalOrder => ({
      id: "ORDER1",
      status: "COMPLETED",
      purchase_units: [
        {
          payments: {
            captures: [
              {
                id: "C",
                status: "COMPLETED",
                seller_receivable_breakdown: {
                  paypal_fee: { currency_code: "USD", value: "4.98" },
                  net_amount: { currency_code: "USD", value: "115.02" },
                  receivable_amount: { currency_code: "EUR", value: "98.75" },
                  exchange_rate: exchangeRate,
                },
              },
            ],
          },
        },
      ],
    });
    const fees = {
      paypal_fee: { currency_code: "USD", value: "4.98" },
      platform_fees: [],
      net_amount: { currency_code: "USD", value: "115.02" },
      receivable_amount: { currency_code: "EUR", value: "98.75" },
    };
    const rate = { value: "0.858", source_currency: "USD", target_currency: "EUR" };
    expect(captureFromOrder(converted(rate))?.seller_receivable_breakdown).toEqual({ ...fees, exchange_rate: rate });
    expect(captureFromOrder(converted({ value: 0.858 }))?.seller_receivable_breakdown).toEqual({
      ...fees,
      exchange_rate: undefined,
    });
  });

  it("drops a malformed breakdown instead of trusting it", () => {
    const malformed: PayPalOrder = {
      id: "ORDER1",
      status: "COMPLETED",
      purchase_units: [
        { payments: { captures: [{ id: "C", status: "COMPLETED", seller_receivable_breakdown: { paypal_fee: { value: 4.98 } } }] } },
      ],
    };
    expect(captureFromOrder(malformed)?.seller_receivable_breakdown).toBeUndefined();
  });

  it("drops the whole breakdown when one platform fee is malformed", () => {
    const malformed: PayPalOrder = {
      id: "ORDER1",
      status: "COMPLETED",
      purchase_units: [
        {
          payments: {
            captures: [
              {
                id: "C",
                status: "COMPLETED",
                seller_receivable_breakdown: {
                  paypal_fee: { currency_code: "USD", value: "4.98" },
                  platform_fees: [{ amount: { currency_code: "USD", value: "1.20" } }, { amount: { value: 1 } }],
                },
              },
            ],
          },
        },
      ],
    };
    expect(captureFromOrder(malformed)?.seller_receivable_breakdown).toBeUndefined();
  });

  it("reads a breakdown without platform fees as no platform fee", () => {
    const breakdown = (platformFees?: PayPalCaptureBreakdown["platform_fees"]): PayPalOrder => {
      const sellerReceivable: Partial<PayPalCaptureBreakdown> = { paypal_fee: { currency_code: "USD", value: "4.98" } };
      if (platformFees) sellerReceivable.platform_fees = platformFees;
      return {
        id: "ORDER1",
        status: "COMPLETED",
        purchase_units: [
          { payments: { captures: [{ id: "C", status: "COMPLETED", seller_receivable_breakdown: sellerReceivable }] } },
        ],
      };
    };
    const expected = { paypal_fee: { currency_code: "USD", value: "4.98" }, platform_fees: [] };
    expect(captureFromOrder(breakdown())?.seller_receivable_breakdown).toEqual(expected);
    expect(captureFromOrder(breakdown([]))?.seller_receivable_breakdown).toEqual(expected);
  });
});

describe("refundsFromOrder", () => {
  it("lists an order's refunds and drops malformed entries", () => {
    const order: PayPalOrder = {
      id: "O",
      status: "COMPLETED",
      purchase_units: [
        {
          payments: {
            refunds: [
              { id: "R1", status: "COMPLETED", amount: { currency_code: "USD", value: "5.00" } },
              { id: "R2", status: "PENDING", amount: { currency_code: "USD", value: "1.00" } },
              { bad: true },
              // The sandbox's $5.00 partial refund of a $19.00 order: PayPal returned its fee and Payleor's.
              {
                id: "R3",
                status: "COMPLETED",
                amount: { currency_code: "USD", value: "5.00" },
                seller_payable_breakdown: {
                  gross_amount: { currency_code: "USD", value: "5.00" },
                  paypal_fee: { currency_code: "USD", value: "0.19" },
                  platform_fees: [{ amount: { currency_code: "USD", value: "0.05" }, payee: { merchant_id: "PAYLEOR" } }],
                  net_amount: { currency_code: "USD", value: "4.76" },
                  total_refunded_amount: { currency_code: "USD", value: "5.00" },
                },
              },
              // A returned fee that cannot be read must not pass for no fee returned.
              {
                id: "R4",
                status: "COMPLETED",
                amount: { currency_code: "USD", value: "2.00" },
                seller_payable_breakdown: { paypal_fee: { value: 0.08 }, net_amount: { currency_code: "USD", value: "1.92" } },
              },
            ],
          },
        },
      ],
    };
    expect(refundsFromOrder(order)).toEqual([
      { id: "R1", status: "COMPLETED", amount: { currency_code: "USD", value: "5.00" } },
      { id: "R2", status: "PENDING", amount: { currency_code: "USD", value: "1.00" } },
      {
        id: "R3",
        status: "COMPLETED",
        amount: { currency_code: "USD", value: "5.00" },
        seller_payable_breakdown: {
          paypal_fee: { currency_code: "USD", value: "0.19" },
          platform_fees: [{ amount: { currency_code: "USD", value: "0.05" } }],
          net_amount: { currency_code: "USD", value: "4.76" },
        },
      },
      { id: "R4", status: "COMPLETED", amount: { currency_code: "USD", value: "2.00" }, seller_payable_breakdown: undefined },
    ]);
  });

  it("returns no refunds when the order has none", () => {
    expect(refundsFromOrder({ id: "O", status: "COMPLETED", purchase_units: [{ payments: {} }] })).toEqual([]);
    expect(refundsFromOrder({ id: "O", status: "COMPLETED" })).toEqual([]);
  });
});
