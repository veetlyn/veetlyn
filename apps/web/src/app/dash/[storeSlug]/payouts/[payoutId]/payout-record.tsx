"use client";

import { Badge } from "@jendal-workspace/ui/components/badge";
import { buttonVariants } from "@jendal-workspace/ui/components/button";
import { cn } from "@jendal-workspace/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import Link from "next/link";

import Loader from "@/components/loader";
import { DocumentPage } from "@/components/page-composition";
import { formatMinor } from "@/lib/money";
import { approvalState, payoutActions, payoutBreakdown, payoutSentMinor, payoutStatusLabel, payoutStatusTone, waitingLine } from "@/lib/payouts";
import { trpc } from "@/utils/trpc";

import { PayoutActions, type TeamPayoutRequest } from "../payout-requests-table";

type Step = { label: string; detail: string; state: "done" | "current" | "todo" };

// Where the money is: a payout that was stopped ends its journey where it stopped.
function journey(request: TeamPayoutRequest, approval: string | null): Step[] {
  const stage = { requested: 1, queued: 2, sending: 2, exported: 2, sent: 2, succeeded: 4, rejected: 1, failed: 2 }[request.status];
  const at = (index: number): Step["state"] => (index < stage ? "done" : index === stage ? "current" : "todo");
  const stopped = request.status === "rejected" || request.status === "failed";
  const steps: Step[] = [
    { label: "Requested", detail: day(request.createdAt), state: "done" },
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

  const sentMinor = payoutSentMinor(request);
  const settled = request.status === "succeeded" && sentMinor !== null;
  const breakdown = payoutBreakdown(request, request.memberName);
  const approval = approvalState(request);
  const waiting = waitingLine(request, new Date());
  const from = team.data?.team.name ?? "The team";
  const when = settled && request.settledAt ? `Paid ${day(request.settledAt)}` : `Requested ${day(request.createdAt)}`;
  // Where the money is only matters while it moves; a settled, rejected or failed payout says so in its badge.
  const moving = request.status !== "succeeded" && request.status !== "rejected" && request.status !== "failed";
  const net = breakdown.find((line) => line.kind === "net");
  const notes = breakdown.filter((line) => line.kind === "note");
  return (
    <DocumentPage className="grid max-w-[840px] gap-8 space-y-0">
      <div className="flex items-center justify-between gap-4">{back}<Badge tone={payoutStatusTone(request)}>{payoutStatusLabel(request)}</Badge></div>

      {moving ? (
        <ol aria-label="Where this payout is" className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {journey(request, approval.progress).map((step) => (
            <li key={step.label} aria-current={step.state === "current" ? "step" : undefined} className="grid content-start gap-1 text-[12px]">
              <span
                className={cn(
                  "grid size-[18px] place-items-center rounded-full border",
                  step.state === "done" && "border-transparent bg-primary text-primary-foreground",
                  step.state === "current" && "border-foreground border-[5px]",
                )}
              >
                {step.state === "done" ? <Check className="size-3" aria-hidden="true" /> : null}
              </span>
              <span className={cn("text-[13px]", step.state === "todo" ? "text-muted-foreground" : "font-medium")}>{step.label}</span>
              <span className="text-muted-foreground">{step.detail}</span>
            </li>
          ))}
        </ol>
      ) : null}

      <article data-financial-document aria-label={settled ? "Payout receipt" : "Payout record"} className="rounded-lg border bg-card px-5 py-7 sm:px-10 sm:py-10">
        <header className="space-y-5 border-b pb-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2"><h1 className="font-heading text-3xl">{settled ? "Payout receipt" : request.status === "succeeded" ? "Payout record" : "Payout request"}</h1><p className="text-muted-foreground">{when}</p></div>
            <span className="text-sm text-muted-foreground">PayPal · {request.currency}</span>
          </div>
          <dl className="space-y-1 text-xs"><dt className="text-muted-foreground">Reference</dt><dd className="break-all font-mono">{request.id}</dd></dl>
        </header>
        <div className="grid gap-8 pt-7">
          <dl className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2"><dt className="text-xs text-muted-foreground">From</dt><dd className="space-y-1"><span className="block font-medium">{from}</span><span className="block text-muted-foreground">PayPal balance</span></dd></div>
            <div className="min-w-0 space-y-2"><dt className="text-xs text-muted-foreground">To</dt><dd className="space-y-1"><span className="block font-medium">{request.memberName}</span><span className="block break-words text-muted-foreground">{request.memberEmail}</span></dd></div>
          </dl>
          <section className="space-y-4" aria-labelledby="transfer-heading"><h2 id="transfer-heading" className="font-medium">{request.projectTitle ?? "Available earnings"}</h2>
          <dl aria-label="Breakdown" className="grid gap-4 border-y py-5">
            {breakdown
              .filter((line) => line.kind === "gross" || line.kind === "deduction")
              .map((line) => (
                <div key={line.label} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{line.label}</dt>
                  <dd className="shrink-0 whitespace-nowrap font-tabular">
                    {line.kind === "deduction" ? "−" : ""}
                    {formatMinor(line.minor, request.currency)}
                  </dd>
                </div>
              ))}
            {net ? (
              <div className="flex items-baseline justify-between gap-4 border-t pt-5">
                <dt className="font-medium">{net.label}</dt>
                <dd className="shrink-0 whitespace-nowrap font-tabular text-xl font-semibold">{formatMinor(net.minor, request.currency)}</dd>
              </div>
            ) : null}
          </dl>
          </section>
          {notes.length > 0 ? (
            // Settling the estimate: what PayPal really took, and what went back to the member.
            <dl aria-label="Fee settled" className="grid gap-3 text-xs">
              {notes.map((line) => (
                <div key={line.label} className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">{line.label}</dt>
                  <dd className="shrink-0 whitespace-nowrap font-tabular">{formatMinor(line.minor, request.currency)}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </article>
      {request.failureMessage ? <p role="alert" className="text-destructive">{request.failureMessage}</p> : null}
      {waiting ? <p className="text-muted-foreground">{waiting}</p> : null}
      {approval.note ? <p className="text-muted-foreground">{approval.note}</p> : null}
      {list.data?.canDecide && payoutActions(request, credentials.data != null).length > 0 ? (
        <div className="[&>div]:justify-start">
          <PayoutActions
            teamSlug={teamSlug}
            request={request}
            automaticPayoutsOn={credentials.data != null}
            ownPayout={request.userId === viewerId}
          />
        </div>
      ) : null}
    </DocumentPage>
  );
}

function day(date: string): string {
  return new Date(date).toLocaleDateString(undefined, { dateStyle: "medium" });
}
