import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

export type PreparedCard = inferRouterOutputs<AppRouter>["agent"]["pending"]["pending"][number]["card"];

export type PreparedRow = { title: string; detail: string; amount?: string; action: string };

// One scannable queue row per prepared decision: who or what it concerns, the prepared object and its timing, the
// price, and the review it opens. The assistant's rationale stays in the thread, not in the queue.
export function preparedRow(card: PreparedCard, clientName: string | null): PreparedRow {
  switch (card.kind) {
    case "quote":
      return {
        title: clientName ?? card.project,
        detail: [clientName ? card.project : null, `Quote, ${card.delivery} delivery`].filter(Boolean).join(" · "),
        amount: card.total,
        action: "Review quote",
      };
    case "payout":
      return {
        title: card.member,
        detail: card.decision === "approve" ? "Payout to approve" : "Payout to reject",
        amount: card.amount,
        action: "Review payout",
      };
    case "message":
      return { title: clientName ?? card.project, detail: `Message · ${card.audience}`, action: "Review message" };
    case "assign":
      return { title: card.project, detail: `Assign to ${card.member}`, action: "Review assignment" };
    case "amendment":
      return { title: clientName ?? card.project, detail: "Change to the accepted quote", action: "Review change" };
  }
}
