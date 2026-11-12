"use client";

import { Badge } from "@jendal-workspace/ui/components/badge";
import { Button } from "@jendal-workspace/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import type { TableColumn } from "@jendal-workspace/ui/components/motion/table";

import { DataList } from "@/components/data-list";
import Loader from "@/components/loader";
import { ListPage, SummaryStrip } from "@/components/page-composition";
import { DISPUTE_REASON_LABELS, DISPUTE_STATUS_LABELS, disputeCaseUrl } from "@/lib/dispute";
import { formatMinor } from "@/lib/money";
import { trpc } from "@/utils/trpc";

type Case = inferRouterOutputs<AppRouter>["money"]["cases"][number];

const DATE: Intl.DateTimeFormatOptions = { dateStyle: "medium" };

function columns(teamSlug: string, paypalEnvironment: string | undefined): TableColumn<Case>[] {
  return [
    { key: "opened", header: "Opened", width: "128px", sortable: true, sortValue: (c) => new Date(c.openedAt).getTime(), cell: (c) => <span className="whitespace-nowrap">{new Date(c.openedAt).toLocaleDateString(undefined, DATE)}</span> },
    {
      key: "reason",
      header: "Dispute",
      sortable: true,
      sortValue: (c) => DISPUTE_REASON_LABELS.get(c.reason) ?? c.reason,
      cell: (c) => (
        <span className="grid min-w-0">
          <span className="truncate font-medium">{DISPUTE_REASON_LABELS.get(c.reason) ?? c.reason}</span>
          {c.open ? <span className="truncate text-xs text-destructive">Payouts are held while it is open</span> : null}
        </span>
      ),
    },
    {
      key: "about",
      header: "About",
      cell: (c) => c.projectId
        ? <Link href={`/${teamSlug}/projects/${c.projectId}`} className="truncate underline underline-offset-4">{c.projectTitle}</Link>
        : <span className="truncate text-muted-foreground">{c.orderId ? "A premade-item order" : "Not matched to a project"}</span>,
    },
    { key: "amount", header: "Amount", width: "112px", align: "right", sortable: true, sortValue: (c) => c.amountMinor ?? -1, cell: (c) => <span className="whitespace-nowrap tabular-nums">{c.amountMinor !== null && c.currency ? formatMinor(c.amountMinor, c.currency) : "Not stated"}</span> },
    { key: "status", header: "Status", width: "176px", sortable: true, sortValue: (c) => DISPUTE_STATUS_LABELS[c.status], cell: (c) => <Badge tone={c.open ? "fail" : c.status === "resolved_seller" ? "good" : "neutral"}>{DISPUTE_STATUS_LABELS[c.status]}</Badge> },
    {
      key: "paypal",
      header: "PayPal case",
      width: "168px",
      cell: (c) => <a href={disputeCaseUrl(paypalEnvironment, c.paypalDisputeId)} target="_blank" rel="noopener noreferrer" className="truncate font-mono text-xs underline underline-offset-4">{c.paypalDisputeId}</a>,
    },
  ];
}

// PayPal cases clients opened on the team's payments. Answering happens on PayPal; this page says what they hold.
export default function TeamCases({ teamSlug, paypalEnvironment }: { teamSlug: string; paypalEnvironment: string | undefined }) {
  const cases = useQuery({ ...trpc.money.cases.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });

  if (cases.isPending) return <Loader />;
  const open = cases.data?.filter((c) => c.open).length ?? 0;
  return (
    <ListPage>
      <div className="space-y-1">
        <h1 className="font-heading text-3xl">Disputes</h1>
        <p className="text-sm text-muted-foreground">Disputes clients opened with the payment provider. Answer them there, with the team's account.</p>
      </div>
      {cases.isError ? (
        <div role="alert" className="space-y-3 rounded-[10px] border p-5 text-sm">
          <p>{cases.error.data?.code === "FORBIDDEN" ? "You don’t have access to Disputes. A team admin can change your access." : cases.error.message}</p>
          {cases.error.data?.code !== "FORBIDDEN" ? <Button type="button" variant="outline" size="sm" onClick={() => void cases.refetch()}>Try again</Button> : null}
        </div>
      ) : (
        <>
          {cases.data.length > 0 ? (
            <SummaryStrip label="Needs attention">
              <p className="text-sm"><span className="font-medium">{open} open {open === 1 ? "dispute" : "disputes"}</span> <span className="text-muted-foreground">holding payouts</span></p>
              <p className="text-sm text-muted-foreground">{cases.data.length - open} closed</p>
            </SummaryStrip>
          ) : null}
          <DataList
            label="Disputes"
            rows={cases.data}
            columns={columns(teamSlug, paypalEnvironment)}
            getRowId={(c) => c.id}
            searchText={(c) => `${DISPUTE_REASON_LABELS.get(c.reason) ?? c.reason} ${c.projectTitle ?? ""} ${c.paypalDisputeId}`}
            searchLabel="Search disputes"
            filters={[{ key: "state", label: "Disputes", options: [{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }], match: (c, v) => (v === "open") === c.open }]}
            defaultSort={{ key: "opened", direction: "desc" }}
            empty={{ title: "No disputes", text: "If a client opens a dispute, its status and any payout hold will appear here." }}
            noun={{ one: "dispute", many: "disputes" }}
          />
        </>
      )}
    </ListPage>
  );
}
