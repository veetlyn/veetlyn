import type { DeliveryStatus } from "@jendal-workspace/core";

// Mirrors the server's delivery rules (packages/api/src/use-cases/projects.ts) so the form can
// explain a refusal before submitting.
const MAX_DELIVERY_NOTE = 5_000;
const MAX_DELIVERY_LINK = 2_000;

export function deliveryDraftProblem(draft: { note: string; link: string }): string | null {
  const note = draft.note.trim();
  const link = draft.link.trim();
  if (!note && !link) return "Add a note or a link.";
  if (note.length > MAX_DELIVERY_NOTE) return "The note is too long.";
  if (link) {
    let protocol: string | null = null;
    try {
      protocol = new URL(link).protocol;
    } catch {
      protocol = null;
    }
    if (protocol !== "https:" || link.length > MAX_DELIVERY_LINK) return "Use an https link.";
  }
  return null;
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
