import { EMAIL_PATTERN, QUOTE_REQUEST_LIMITS } from "../sellers/quote-request";

// Sellers design §5.3.
export const ORDER_STATUSES = ["pending", "paid", "refunded"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// Sellers design §5.2: a download link lasts 7 days and allows 5 downloads.
export const DOWNLOAD_GRANT_DAYS = 7;
export const DOWNLOADS_PER_GRANT = 5;

export type GrantState = "usable" | "used_up" | "expired" | "revoked";

export function grantState(
  grant: { downloadsLeft: number; expiresAt: Date; revokedAt: Date | null },
  now: Date,
): GrantState {
  if (grant.revokedAt) return "revoked";
  if (now.getTime() >= grant.expiresAt.getTime()) return "expired";
  if (grant.downloadsLeft <= 0) return "used_up";
  return "usable";
}

// The order page shows only a hint of where a new link goes; the address itself stays private.
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•";
  return `${email[0]}•${email.slice(at)}`;
}

export function grantExpiry(now: Date): Date {
  return new Date(now.getTime() + DOWNLOAD_GRANT_DAYS * 86_400_000);
}

export function buyerEmailProblem(email: string): string | null {
  const trimmed = email.trim();
  return EMAIL_PATTERN.test(trimmed) && trimmed.length <= QUOTE_REQUEST_LIMITS.maxEmail
    ? null
    : "That email address does not look right.";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PayPal's custom_id for a store order. Project payments use the bare payment id, so the prefix tells them apart.
export function orderCustomId(orderId: string): string {
  return `order:${orderId}`;
}

export function orderIdFromCustomId(customId: string | null): string | null {
  if (!customId?.startsWith("order:")) return null;
  const id = customId.slice("order:".length);
  return UUID.test(id) ? id : null;
}
