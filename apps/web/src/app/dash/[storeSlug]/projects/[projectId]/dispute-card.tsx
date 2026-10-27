import { formatMoney, money, type MoneyCurrency } from "@jendal-workspace/core";
import { Badge } from "@jendal-workspace/ui/components/badge";
import { buttonVariants } from "@jendal-workspace/ui/components/button";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import {
  DISPUTE_OUTCOME_LABELS,
  DISPUTE_REASON_LABELS,
  DISPUTE_STATUS_LABELS,
  disputeCaseUrl,
  disputeEffect,
  disputeIsOpen,
} from "@/lib/dispute";

type Dispute = NonNullable<inferRouterOutputs<AppRouter>["project"]["get"]["dispute"]>;

const DATE_TIME: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

// The project's PayPal case as the webhooks last told it, with the way to answer it on PayPal.
// A project's payments are all in its currency, so the disputed amount is too.
export function DisputeCard({
  dispute,
  currency,
  paypalEnvironment,
}: {
  dispute: Dispute;
  currency: MoneyCurrency;
  paypalEnvironment: string | undefined;
}) {
  const open = disputeIsOpen(dispute.status);
  const tone = open ? "fail" : dispute.status === "resolved_seller" ? "good" : "neutral";
  return (
    <section aria-labelledby="dispute-heading" className="panel space-y-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="dispute-heading" className="text-lg font-semibold">
          PayPal dispute
        </h2>
        <Badge tone={tone}>{DISPUTE_STATUS_LABELS[dispute.status]}</Badge>
      </div>
      <p className={open ? "font-medium text-destructive" : "text-sm text-muted-foreground"}>{disputeEffect(dispute.status)}</p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <Row label="Case">{dispute.paypalDisputeId}</Row>
        <Row label="Reason">{DISPUTE_REASON_LABELS.get(dispute.reason) ?? dispute.reason}</Row>
        <Row label="Amount">
          {dispute.amountMinor !== null ? formatMoney(money(currency, dispute.amountMinor)) : "Not reported yet"}
        </Row>
        <Row label="Opened">{new Date(dispute.openedAt).toLocaleString(undefined, DATE_TIME)}</Row>
        {dispute.resolvedAt ? <Row label="Closed">{new Date(dispute.resolvedAt).toLocaleString(undefined, DATE_TIME)}</Row> : null}
        {dispute.outcome ? <Row label="Outcome">{DISPUTE_OUTCOME_LABELS.get(dispute.outcome) ?? dispute.outcome}</Row> : null}
      </dl>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <a
          href={disputeCaseUrl(paypalEnvironment, dispute.paypalDisputeId)}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: open ? "default" : "outline", size: "sm" })}
        >
          {open ? "Answer the case on PayPal" : "View the case on PayPal"}
        </a>
        {open ? <p className="text-xs text-muted-foreground">Sign in with the team's PayPal account.</p> : null}
      </div>
    </section>
  );
}
