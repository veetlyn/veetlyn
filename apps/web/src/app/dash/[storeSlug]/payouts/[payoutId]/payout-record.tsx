"use client";

import { buttonVariants } from "@jendal-workspace/ui/components/button";
import { cn } from "@jendal-workspace/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check } from "lucide-react";
import Link from "next/link";

import Loader from "@/components/loader";
import { DocumentPage } from "@/components/page-composition";
import { formatMinor } from "@/lib/money";
import { approvalState, payoutActions, payoutFeeLine, payoutSentMinor, payoutStatusLabel, waitingLine } from "@/lib/payouts";
import { trpc } from "@/utils/trpc";

import { PayoutActions, type TeamPayoutRequest } from "../payout-requests-table";

type Step = { label: string; detail: string; state: "done" | "current" | "todo" };

// Where the money is: a payout that was stopped ends its journey where it stopped.
function journey(request: TeamPayoutRequest, approval: string | null): Step[] {
  const stage = { requested: 1, queued: 2, sending: 2, exported: 2, sent: 2, succeeded: 4, rejected: 1, failed: 2 }[request.status];
  const at = (index: number): Step["state"] => (index < stage ? "done" : index === stage ? "current" : "todo");
  const stopped = request.status === "rejected" || request.status === "failed";
  const steps: Step[] = [
    { label: "Requested", detail: new Date(request.createdAt).toLocaleDateString(), state: "done" },
    { label: request.status === "rejected" ? "Rejected" : "Approval", detail: request.status === "rejected" ? "Not sent" : (approval ?? (stage > 1 ? "Approved" : "An admin decides")), state: at(1) },
    { label: request.status === "failed" ? "Failed" : "Sending", detail: request.status === "failed" ? "PayPal did not pay it" : stage > 2 ? "Sent" : "On payday, through PayPal", state: at(2) },
    { label: "Received", detail: `In ${request.memberName.split(" ")[0]}'s PayPal`, state: stage === 4 ? "done" : "todo" },
  ];
  // A stopped payout has no steps ahead of it.
  return stopped ? steps.slice(0, stage + 1) : steps;
}

export default function PayoutRecord({ teamSlug, payoutId, viewerId }: { teamSlug: string; payoutId: string; viewerId: string }) {
  const list = useQuery({ ...trpc.payouts.list.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const credentials = useQuery({ ...trpc.payouts.credentials.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const team = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });

  if (list.isPending) return <Loader />;
  const request = list.data?.payouts.find((payout) => payout.id === payoutId);
  const back = (
    <Link href={`/${teamSlug}/payouts`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
      All payouts
    </Link>
  );
  if (!request) {
    return (
      <DocumentPage>
        <h1 className="font-heading text-3xl">Payout not found</h1>
        <p className="text-sm text-muted-foreground">It may have been removed, or only admins can see it.</p>
        {back}
      </DocumentPage>
    );
  }

  const amount = formatMinor(request.amountMinor, request.currency);
  const fee = payoutFeeLine(request);
  const sentMinor = payoutSentMinor(request);
  const approval = approvalState(request);
  const waiting = waitingLine(request, new Date());
  const from = team.data?.team.name ?? "The team";
  return (
    <DocumentPage className="grid gap-6 space-y-0">
      <header className="flex items-start justify-between gap-4">
        <div className="grid gap-1">
          <p className="text-[13px] font-medium text-muted-foreground">{payoutStatusLabel(request)}</p>
          <h1 className="font-heading text-3xl">
            {amount} to {request.memberName}
          </h1>
          <p className="text-sm text-muted-foreground">{request.projectTitle ?? "Available earnings"}</p>
        </div>
        {back}
      </header>

      <ol aria-label="Where this payout is" className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {journey(request, approval.progress).map((step) => (
          <li key={step.label} aria-current={step.state === "current" ? "step" : undefined} className="grid content-start gap-1 text-[13px]">
            <span
              className={cn(
                "grid size-[18px] place-items-center rounded-full border",
                step.state === "done" && "border-transparent bg-primary text-primary-foreground",
                step.state === "current" && "border-foreground border-[5px]",
              )}
            >
              {step.state === "done" ? <Check className="size-3" aria-hidden="true" /> : null}
            </span>
            <span className={cn("text-[14px]", step.state === "todo" ? "text-muted-foreground" : "font-medium")}>{step.label}</span>
            <span className="text-muted-foreground">{step.detail}</span>
          </li>
        ))}
      </ol>

      <section aria-labelledby="transfer-heading" className="frame frame-panel">
        <div className="frame-head text-[14px]">
          <h2 id="transfer-heading" className="font-medium">
            Transfer
          </h2>
        </div>
        <div className="frame frame-body grid gap-4 p-4 text-[14px]">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 border-b pb-4">
            <div className="grid min-w-0">
              <span className="text-xs text-muted-foreground">From</span>
              <b className="truncate font-medium">{from}</b>
              <span className="text-muted-foreground">PayPal balance</span>
            </div>
            <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" />
            <div className="grid min-w-0">
              <span className="text-xs text-muted-foreground">To</span>
              <b className="truncate font-medium">{request.memberName}</b>
              <span className="truncate text-muted-foreground">{request.memberEmail}</span>
            </div>
          </div>
          <dl className="grid max-w-md gap-2">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Requested</dt>
              <dd className="font-tabular">{amount}</dd>
            </div>
            {fee ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{fee.label}</dt>
                <dd className="font-tabular">{formatMinor(fee.feeMinor, request.currency)}</dd>
              </div>
            ) : null}
            {sentMinor !== null ? (
              <div className="flex justify-between gap-4 border-t pt-2 font-medium">
                <dt>{request.status === "succeeded" ? "Received" : "Receives"}</dt>
                <dd className="font-tabular">{formatMinor(sentMinor, request.currency)}</dd>
              </div>
            ) : null}
          </dl>
          {request.failureMessage ? <p className="text-destructive">{request.failureMessage}</p> : null}
          {waiting ? <p className="text-muted-foreground">{waiting}</p> : null}
          {approval.note ? <p className="text-muted-foreground">{approval.note}</p> : null}
          {list.data?.canDecide && payoutActions(request, credentials.data != null).length > 0 ? (
            <div className="border-t pt-4 [&>div]:justify-start">
              <PayoutActions
                teamSlug={teamSlug}
                request={request}
                automaticPayoutsOn={credentials.data != null}
                ownPayout={request.userId === viewerId}
              />
            </div>
          ) : null}
        </div>
      </section>
    </DocumentPage>
  );
}
