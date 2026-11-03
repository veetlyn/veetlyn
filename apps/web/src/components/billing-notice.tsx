"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { trpc } from "@/utils/trpc";

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long" });

// Billing design §7: trial ending in 3 days or less, a payment in grace, or selling paused. Only the people who can
// change the plan are sent to Billing; everyone else is told who can.
export default function BillingNotice({ slug }: { slug: string }) {
  const notice = useQuery({ ...trpc.billing.notice.queryOptions({ teamSlug: slug }), staleTime: 300_000 });
  const n = notice.data;
  if (!n) return null;
  const text =
    n.state === "lapsed"
      ? "Selling is paused: clients cannot pay and shoppers cannot buy. Paid work, deliveries and refunds continue."
      : n.state === "grace"
        ? n.subscribed
          ? `The last payment for this workspace failed. Selling pauses on ${n.graceEndsAt ? day(n.graceEndsAt) : "soon"} unless the card is updated.`
          : `The free trial has ended. Selling pauses on ${n.graceEndsAt ? day(n.graceEndsAt) : "soon"} unless a plan is chosen.`
        : `The free trial ends on ${n.trialEndsAt ? day(n.trialEndsAt) : "soon"}. Choose a plan to keep selling.`;
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5 md:px-7 ${n.state === "trial" ? "bg-tray" : "bg-destructive/10"}`}
      role="status"
    >
      <p className="text-sm">{text}</p>
      {n.canManage ? (
        <Link href={`/w/${n.organizationId}/billing`} className="text-sm font-semibold underline underline-offset-4">
          {n.state === "trial" ? "Choose a plan" : "Go to Billing"}
        </Link>
      ) : (
        <p className="text-sm text-muted-foreground">A workspace owner or admin can fix this.</p>
      )}
    </div>
  );
}
