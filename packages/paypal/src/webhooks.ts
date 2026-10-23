import type { z } from "zod";

import type { PayPalRequest } from "./client";
import { type JsonBody, webhookEventSchema, webhookUnitSchema, webhookVerificationSchema } from "./schemas";

export type WebhookTransmission = {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
};

// The ids the platform keeps from a verified event. The payload itself is not stored: order resources carry the
// buyer's name and email, and the processor re-fetches the resource from PayPal anyway.
export type ParsedWebhookEvent = {
  id: string;
  eventType: string;
  resourceType: string | null;
  resourceId: string | null;
  customId: string | null;
  orderId: string | null;
  captureId: string | null;
  merchantId: string | null;
};

type WebhookResource = NonNullable<z.output<typeof webhookEventSchema>["resource"]>;

// R1 facts §4: a refund names its capture only through the "up" link, …/v2/payments/captures/{id}.
function refundedCaptureId(resource: WebhookResource | null): string | null {
  for (const link of resource?.links ?? []) {
    if (link.rel === "up" && link.href) {
      const match = /\/v2\/payments\/captures\/([^/?#]+)/.exec(link.href);
      if (match?.[1]) return match[1];
    }
  }
  return null;
}

function firstUnit(units: readonly unknown[]) {
  const parsed = webhookUnitSchema.safeParse(units[0]);
  return parsed.success ? parsed.data : null;
}

// R1 facts §4: capture resources carry custom_id, payee and the order id in supplementary_data; order
// resources (any event type: CHECKOUT.ORDER.* and CHECKOUT.PAYMENT-APPROVAL.REVERSED alike) carry them on
// their first purchase unit.
export function parseWebhookEvent(body: JsonBody): ParsedWebhookEvent | null {
  const parsed = webhookEventSchema.safeParse(body);
  if (!parsed.success) return null;
  const event = parsed.data;
  const resource = event.resource;
  const base = {
    id: event.id,
    eventType: event.event_type,
    resourceType: event.resource_type,
    resourceId: resource?.id ?? null,
  };
  // A refund's custom_id is the refund's own value, not our payment id, and its seller is the payer. It is
  // matched to a payment through the refunded capture instead.
  if (event.resource_type === "refund") {
    return {
      ...base,
      customId: null,
      orderId: null,
      captureId: refundedCaptureId(resource),
      merchantId: resource?.payer?.merchant_id ?? null,
    };
  }
  const units = resource?.purchase_units ?? null;
  const isOrder = units !== null;
  const unit = units ? firstUnit(units) : resource;
  return {
    ...base,
    customId: unit?.custom_id ?? null,
    orderId: isOrder ? (resource?.id ?? null) : (resource?.supplementary_data?.related_ids?.order_id ?? null),
    captureId: isOrder ? null : (resource?.id ?? null),
    merchantId: unit?.payee?.merchant_id ?? null,
  };
}

export function createWebhooks(request: PayPalRequest) {
  return {
    // The postback check (R1 facts §4). rawBody must be the JSON text the caller already parsed, exactly as
    // received: it is spliced in as webhook_event, since re-serializing can change its bytes and fail
    // verification. The request id is fresh per call so an idempotent replay never answers for another body.
    async verifySignature(input: { webhookId: string; headers: WebhookTransmission; rawBody: string }): Promise<boolean> {
      const fields = JSON.stringify({
        auth_algo: input.headers.authAlgo,
        cert_url: input.headers.certUrl,
        transmission_id: input.headers.transmissionId,
        transmission_sig: input.headers.transmissionSig,
        transmission_time: input.headers.transmissionTime,
        webhook_id: input.webhookId,
      });
      const response = await request(
        {
          method: "POST",
          path: "/v1/notifications/verify-webhook-signature",
          requestId: `verify:${crypto.randomUUID()}`,
          rawBody: `${fields.slice(0, -1)},"webhook_event":${input.rawBody}}`,
        },
        webhookVerificationSchema,
      );
      return response.verification_status === "SUCCESS";
    },
  };
}
