"use client";

import { Badge } from "@jendal-workspace/ui/components/badge";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

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

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 md:px-7 md:py-8">
      <div className="space-y-1">
        <h1 className="font-heading text-3xl">Payments</h1>
        <p className="text-sm text-muted-foreground">What clients paid on the team's projects, through PayPal.</p>
      </div>
      {payments.isPending ? (
        <Loader />
      ) : payments.isError ? (
        <p className="text-sm text-muted-foreground">
          {payments.error.data?.code === "FORBIDDEN" ? "Only an admin can see payments." : payments.error.message}
        </p>
      ) : payments.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No client payments yet.</p>
      ) : (
        <div className="panel relative overflow-x-auto">
          <table className="w-full text-sm">
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
              {payments.data.map((p) => (
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
                  <td className="px-4 py-3 tabular-nums">{formatMinor(p.amountMinor, p.currency)}</td>
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
