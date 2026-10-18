import type { AmendmentStatus, PaymentStatus, QuoteStatus } from "@jendal-workspace/core";

// The words people see for record states; the enums stay as they are in core.
export const QUOTE_STATUS_LABELS = {
  proposed: "Sent",
  accepted: "Accepted",
  superseded: "Replaced",
  rejected: "Declined",
} as const satisfies Record<QuoteStatus, string>;

export const PAYMENT_STATUS_LABELS = {
  pending: "Waiting",
  captured: "Paid",
  failed: "Failed",
  cancelled: "Cancelled",
  refunded: "Refunded",
} as const satisfies Record<PaymentStatus, string>;

export const AMENDMENT_STATUS_LABELS = {
  pending: "Waiting",
  accepted: "Accepted",
  declined: "Declined",
} as const satisfies Record<AmendmentStatus, string>;
