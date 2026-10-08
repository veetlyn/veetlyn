import type { PayPalRequest } from "./client";

export type WebhookTransmission = {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
};

// The ids Payleor keeps from a verified event. The payload itself is not stored: order resources carry the
// buyer's name and email, and the processor re-fetches the resource from PayPal anyway.
export type ParsedWebhookEvent = {
  id: string;
  eventType: string;
  resourceType: string | null;
  resourceId: string | null;
  customId: string | null;
  orderId: string | null;
  merchantId: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// R1 facts §4: capture resources carry custom_id, payee and the order id in supplementary_data; order
// resources carry them on their first purchase unit.
export function parseWebhookEvent(body: unknown): ParsedWebhookEvent | null {
  const event = record(body);
  const id = text(event?.id);
  const eventType = text(event?.event_type);
  if (!event || !id || !eventType) return null;
  const resource = record(event.resource);
  const isOrder = eventType.startsWith("CHECKOUT.ORDER.");
  const unit = isOrder && Array.isArray(resource?.purchase_units) ? record(resource.purchase_units[0]) : resource;
  const relatedIds = record(record(resource?.supplementary_data)?.related_ids);
  return {
    id,
    eventType,
    resourceType: text(event.resource_type),
    resourceId: text(resource?.id),
    customId: text(unit?.custom_id),
    orderId: isOrder ? text(resource?.id) : text(relatedIds?.order_id),
    merchantId: text(record(unit?.payee)?.merchant_id),
  };
}

export function createWebhooks(request: PayPalRequest) {
  return {
    // The postback check (R1 facts §4). webhook_event is spliced in as received: re-serializing it can
    // change its bytes and fail verification.
    async verifySignature(input: { webhookId: string; headers: WebhookTransmission; rawBody: string }): Promise<boolean> {
      const fields = JSON.stringify({
        auth_algo: input.headers.authAlgo,
        cert_url: input.headers.certUrl,
        transmission_id: input.headers.transmissionId,
        transmission_sig: input.headers.transmissionSig,
        transmission_time: input.headers.transmissionTime,
        webhook_id: input.webhookId,
      });
      const response = await request<{ verification_status?: string }>({
        method: "POST",
        path: "/v1/notifications/verify-webhook-signature",
        requestId: `verify:${input.headers.transmissionId}`,
        rawBody: `${fields.slice(0, -1)},"webhook_event":${input.rawBody}}`,
      });
      return response.verification_status === "SUCCESS";
    },
  };
}
