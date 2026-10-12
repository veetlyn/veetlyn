import type { PayoutRequestStatus } from "@jendal-workspace/core";

export const ADMIN_STATUS_LABELS = {
  requested: "Waiting for payment",
  paid: "Paid",
  rejected: "Rejected",
} satisfies Record<PayoutRequestStatus, string>;

export const MEMBER_STATUS_LABELS = {
  requested: "Waiting for the team to pay",
  paid: "Paid",
  rejected: "Rejected",
} satisfies Record<PayoutRequestStatus, string>;
