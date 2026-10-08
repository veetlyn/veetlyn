import type { DeliveryStatus } from "@jendal-workspace/core";

// Mirrors the server's delivery rules (packages/api/src/use-cases/projects.ts) so the form can
// explain a refusal before submitting.
export const MAX_DELIVERY_NOTE = 5_000;
const MAX_DELIVERY_LINK = 2_000;

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function deliveryDraftProblem(draft: { note: string; link: string }): string | null {
  const note = draft.note.trim();
  const link = draft.link.trim();
  if (!note && !link) return "Add a note or a link.";
  if (note.length > MAX_DELIVERY_NOTE) return "The note is too long.";
  if (link && (!isHttpsUrl(link) || link.length > MAX_DELIVERY_LINK)) return "Use an https link.";
  return null;
}

// Stored links are rendered as anchors; re-checking keeps a javascript: or http link out of href
// even if one ever reaches the database.
export function safeHttpsLink(link: string | null): string | null {
  return link !== null && isHttpsUrl(link) ? link : null;
}

const CLIENT_LABELS: Record<DeliveryStatus, string> = {
  submitted: "Waiting for your answer",
  accepted: "Accepted",
  changes_requested: "Changes requested",
};

const STAFF_LABELS: Record<DeliveryStatus, string> = {
  submitted: "Waiting for the client",
  accepted: "Accepted",
  changes_requested: "Changes requested",
};

export function deliveryStatusLabel(status: DeliveryStatus): string {
  return CLIENT_LABELS[status];
}

export function deliveryStaffStatusLabel(status: DeliveryStatus): string {
  return STAFF_LABELS[status];
}

export function newestFirst<T extends { createdAt: string | Date }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
