"use client";

import { Badge } from "@jendal-workspace/ui/components/badge";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import Loader from "@/components/loader";
import { DISPUTE_REASON_LABELS, DISPUTE_STATUS_LABELS, disputeCaseUrl } from "@/lib/dispute";
import { formatMinor } from "@/lib/money";
import { trpc } from "@/utils/trpc";

type Case = inferRouterOutputs<AppRouter>["money"]["cases"][number];

const DATE: Intl.DateTimeFormatOptions = { dateStyle: "medium" };

function CaseRows({ cases, teamSlug, paypalEnvironment }: { cases: Case[]; teamSlug: string; paypalEnvironment: string | undefined }) {
  return (
    <ul className="panel divide-y">
      {cases.map((c) => (
        <li key={c.id} className="grid gap-1.5 px-4 py-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="font-medium">{DISPUTE_REASON_LABELS.get(c.reason) ?? c.reason}</p>
            <Badge tone={c.open ? "fail" : c.status === "resolved_seller" ? "good" : "neutral"}>{DISPUTE_STATUS_LABELS[c.status]}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Opened {new Date(c.openedAt).toLocaleDateString(undefined, DATE)}
            {c.amountMinor !== null && c.currency ? ` · ${formatMinor(c.amountMinor, c.currency)}` : ""}
            {" · "}
            {c.projectId ? (
              <Link href={`/${teamSlug}/projects/${c.projectId}`} className="underline underline-offset-4">
                {c.projectTitle}
              </Link>
            ) : c.orderId ? (
              "A store order"
            ) : (
              "Not matched to a project"
            )}
            {" · "}
            <a href={disputeCaseUrl(paypalEnvironment, c.paypalDisputeId)} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
              {c.paypalDisputeId}
            </a>
          </p>
          {c.open ? <p className="text-sm text-destructive">Payouts on this team are held while the case is open.</p> : null}
        </li>
      ))}
    </ul>
  );
}

// PayPal cases clients opened on the team's payments. Answering happens on PayPal; this page says what they hold.
export default function TeamCases({ teamSlug, paypalEnvironment }: { teamSlug: string; paypalEnvironment: string | undefined }) {
  const cases = useQuery({ ...trpc.money.cases.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });

  if (cases.isPending) return <Loader />;
  const open = cases.data?.filter((c) => c.open) ?? [];
  const closed = cases.data?.filter((c) => !c.open) ?? [];
  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 md:px-7 md:py-8">
      <div className="space-y-1">
        <h1 className="font-heading text-3xl">PayPal cases</h1>
        <p className="text-sm text-muted-foreground">Disputes clients opened with PayPal. Answer them on PayPal with the team's account.</p>
      </div>
      {cases.isError ? (
        <p className="text-sm text-muted-foreground">
          {cases.error.data?.code === "FORBIDDEN" ? "Only an admin can see PayPal cases." : cases.error.message}
        </p>
      ) : cases.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No PayPal cases. When a client opens one, it shows here.</p>
      ) : (
        <>
          {open.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold">Open</h2>
              <CaseRows cases={open} teamSlug={teamSlug} paypalEnvironment={paypalEnvironment} />
            </section>
          ) : null}
          {closed.length > 0 ? (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold">Closed</h2>
              <CaseRows cases={closed} teamSlug={teamSlug} paypalEnvironment={paypalEnvironment} />
            </section>
          ) : null}
        </>
      )}
    </main>
  );
}
