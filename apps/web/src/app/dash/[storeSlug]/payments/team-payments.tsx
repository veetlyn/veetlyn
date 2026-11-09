"use client";

import { Badge } from "@jendal-workspace/ui/components/badge";
import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { nativeSelectClass } from "@jendal-workspace/ui/lib/native-select";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import Loader from "@/components/loader";
import { formatMinor } from "@/lib/money";
import { PAYMENT_KIND_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/status-labels";
import { trpc } from "@/utils/trpc";

const DATE: Intl.DateTimeFormatOptions = { dateStyle: "medium" };

const TONES = { pending: "neutral", captured: "good", failed: "fail", cancelled: "neutral", refunded: "neutral" } as const;

const HEADINGS = ["Date", "Project", "Client", "Kind", "Amount", "PayPal fee", "Refunded", "Status"];

// Money in from clients: every payment on the team's projects, the PayPal fee it cost and what went back.
export default function TeamPayments({ teamSlug }: { teamSlug: string }) {
  const payments = useQuery({ ...trpc.money.payments.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const matching = (payments.data ?? []).filter((payment) =>
    (status === "all" || payment.status === status) && `${payment.projectTitle} ${payment.clientName ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 md:px-7 md:py-8">
      <div className="space-y-1">
        <h1 className="font-heading text-3xl">Payments</h1>
        <p className="text-sm text-muted-foreground">What clients paid on the team's projects, through PayPal.</p>
      </div>
      {payments.isSuccess && payments.data.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="w-full sm:max-w-64"><span className="sr-only">Search payments by project or client</span><Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search payments…" /></label>
          <label><span className="sr-only">Payment status</span><select className={nativeSelectClass} value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All statuses</option>
            {Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
        </div>
      ) : null}
      {payments.isPending ? (
        <Loader />
      ) : payments.isError ? (
        <div role="alert" className="space-y-3 rounded-[10px] border p-5 text-sm">
          <p>{payments.error.data?.code === "FORBIDDEN" ? "You don’t have access to Payments. A team admin can change your access." : payments.error.message}</p>
          {payments.error.data?.code !== "FORBIDDEN" ? <Button type="button" variant="outline" size="sm" onClick={() => void payments.refetch()}>Try again</Button> : null}
        </div>
      ) : payments.data.length === 0 ? (
        <section className="rounded-[10px] border px-5 py-10 text-center">
          <h2 className="font-heading text-lg">No client payments yet</h2>
          <p className="mt-2 text-sm text-muted-foreground">Deposits, balances and refunds will appear here as clients pay through PayPal.</p>
        </section>
      ) : matching.length === 0 ? (
        <section className="rounded-[10px] border px-5 py-10 text-center">
          <h2 className="font-heading text-lg">No matching payments</h2>
          <p className="mt-2 text-sm text-muted-foreground">Try another project, client or status.</p>
          <Button type="button" variant="outline" className="mt-4" onClick={() => { setSearch(""); setStatus("all"); }}>Clear filters</Button>
        </section>
      ) : (
        <div role="region" aria-label="Payment history" tabIndex={0} className="panel relative overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Client payments, provider fees and refunds</caption>
            <thead className="border-b bg-secondary/60 text-left text-xs text-muted-foreground">
              <tr>
                {HEADINGS.map((heading) => (
                  <th key={heading} scope="col" className="px-4 py-2.5 font-medium">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {matching.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {new Date(p.capturedAt ?? p.createdAt).toLocaleDateString(undefined, DATE)}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/${teamSlug}/projects/${p.projectId}`} className="underline underline-offset-4">
                      {p.projectTitle}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{p.clientName ?? "Client"}</td>
                  <td className="px-4 py-3">{PAYMENT_KIND_LABELS[p.kind]}</td>
                   <td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">{formatMinor(p.amountMinor, p.currency)}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {p.paypalFeeMinor === null ? "Not reported yet" : formatMinor(p.paypalFeeMinor, p.currency)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{p.refundedMinor > 0 ? formatMinor(p.refundedMinor, p.currency) : "None"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={TONES[p.status]}>{PAYMENT_STATUS_LABELS[p.status]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
