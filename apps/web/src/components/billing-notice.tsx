"use client";

import { useQuery } from "@tanstack/react-query";
import { Alert, AlertAction, AlertContent, AlertDescription, AlertIcon } from "@jendal-workspace/ui/components/motion/alert";
import Link from "next/link";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import { trpc } from "@/utils/trpc";

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long" });

// Billing design §7: trial ending in 3 days or less, a payment in grace, or selling paused. Only the people who can
// change the plan are sent to Billing; everyone else is told who can.
export default function BillingNotice({ slug }: { slug: string }) {
  const notice = useQuery({ ...trpc.billing.notice.queryOptions({ teamSlug: slug }), staleTime: 300_000 });
  return notice.data ? <BillingNoticeView notice={notice.data} /> : null;
}

export type BillingNoticeData = NonNullable<inferRouterOutputs<AppRouter>["billing"]["notice"]>;

export function BillingNoticeView({ notice: n }: { notice: BillingNoticeData }) {
  const text =
    n.state === "lapsed"
      ? "Selling is paused: clients cannot pay and shoppers cannot buy. Paid work, deliveries and refunds continue."
      : n.state === "grace"
        ? n.subscribed
          ? `The last payment for this workspace failed. Selling pauses on ${n.graceEndsAt ? day(n.graceEndsAt) : "soon"} unless the card is updated.`
          : `The free trial has ended. Selling pauses on ${n.graceEndsAt ? day(n.graceEndsAt) : "soon"} unless a plan is chosen.`
        : `The free trial ends on ${n.trialEndsAt ? day(n.trialEndsAt) : "soon"}. Choose a plan to keep selling.`;
  // beUI's Alert. A notice that stays until billing changes is a status, not an interrupting alert.
  return (
    <Alert
      variant={n.state === "trial" ? "info" : n.state === "lapsed" ? "destructive" : "warning"}
      role="status"
      className="rounded-none border-0 border-b"
      contentClassName="px-4 py-2.5 md:px-7"
    >
      <AlertIcon />
      <AlertContent>
        <AlertDescription className="text-foreground">{text}</AlertDescription>
      </AlertContent>
      <AlertAction>
        {n.canManage ? (
          <Link href={`/w/${n.organizationId}/billing`} className="text-sm font-semibold text-foreground underline underline-offset-4">
            {n.state === "trial" ? "Choose a plan" : "Go to Billing"}
          </Link>
        ) : (
          <p className="text-sm text-muted-foreground">A workspace owner or admin can fix this.</p>
        )}
      </AlertAction>
    </Alert>
  );
}
