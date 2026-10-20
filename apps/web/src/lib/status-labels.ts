import type { AmendmentStatus, PaymentStatus, ProjectStatus, QuoteStatus } from "@jendal-workspace/core";

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

// Mint when the next move belongs to whoever is looking, grey while they wait on the other side.
export const TEAM_PROJECT_TONES = {
  quoting: "brand",
  awaiting_deposit: "neutral",
  in_progress: "brand",
  delivered: "neutral",
  awaiting_balance: "neutral",
  completed: "good",
  cancelled: "neutral",
  declined: "neutral",
  expired: "neutral",
} as const satisfies Record<ProjectStatus, "brand" | "good" | "neutral">;

export const CLIENT_PROJECT_TONES = {
  quoting: "neutral",
  awaiting_deposit: "brand",
  in_progress: "neutral",
  delivered: "brand",
  awaiting_balance: "brand",
  completed: "good",
  cancelled: "neutral",
  declined: "neutral",
  expired: "neutral",
} as const satisfies Record<ProjectStatus, "brand" | "good" | "neutral">;
