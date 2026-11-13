"use client";

import { projectStatusLabel } from "@jendal-workspace/core";
import { Badge } from "@jendal-workspace/ui/components/badge";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import Loader from "@/components/loader";
import { formatMinor } from "@/lib/money";
import { CLIENT_PROJECT_TONES } from "@/lib/status-labels";
import { trpc } from "@/utils/trpc";

// The client's move is the mint tone: paying a deposit, reviewing a delivery, paying the balance.
const waitsOnYou = (status: keyof typeof CLIENT_PROJECT_TONES) => CLIENT_PROJECT_TONES[status] === "brand";

function Block({ title, href, linkLabel, children }: { title: string; href: string; linkLabel: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="panel space-y-3 p-5">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <Link href={href} className="text-sm underline underline-offset-4">
          {linkLabel}
        </Link>
      </div>
      {children}
    </section>
  );
}

// The personal workspace: what the person buys from sellers and what teams owe them, apart from any team they run.
export default function PersonalHome() {
  const projects = useQuery({ ...trpc.project.mine.queryOptions({}), retry: false, meta: { silent: true } });
  const payouts = useQuery({ ...trpc.payouts.mine.queryOptions(), retry: false, meta: { silent: true } });

  if (projects.isPending || payouts.isPending) return <Loader />;
  const purchases = projects.data ?? [];
  const waiting = purchases.filter((p) => waitsOnYou(p.status));
  const earnings = payouts.data?.earnings ?? [];
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 md:px-7 md:py-8">
      <div className="space-y-1">
        <h1 className="font-heading text-3xl">Personal</h1>
        <p className="text-sm text-muted-foreground">Your purchases and your earnings, whichever teams they are with.</p>
      </div>
      <Block title="Your projects" href="/me/projects" linkLabel="All projects">
        {projects.isError ? (
          <p role="alert" className="text-sm text-destructive">{projects.error.message}</p>
        ) : purchases.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing bought yet. Requests you send with this account's email show here.</p>
        ) : (
          <>
            <p className="text-sm">
              {waiting.length === 0 ? "Nothing waits on you." : waiting.length === 1 ? "1 project waits on you." : `${waiting.length} projects wait on you.`}
            </p>
            <ul className="divide-y">
              {(waiting.length > 0 ? waiting : purchases).slice(0, 3).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    {p.clientUrl ? (
                      <a href={p.clientUrl} className="truncate font-medium underline-offset-4 hover:underline">{p.title}</a>
                    ) : (
                      <p className="truncate font-medium">{p.title}</p>
                    )}
                    <p className="truncate text-sm text-muted-foreground">{p.teamName}</p>
                  </div>
                  <Badge tone={CLIENT_PROJECT_TONES[p.status]}>{projectStatusLabel(p.status)}</Badge>
                </li>
              ))}
            </ul>
          </>
        )}
      </Block>
      <Block title="Your earnings" href="/me/payouts" linkLabel="Payouts">
        {payouts.isError ? (
          <p role="alert" className="text-sm text-destructive">{payouts.error.message}</p>
        ) : earnings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No earnings yet. Work you deliver for a team shows here once the client pays.</p>
        ) : (
          <ul className="divide-y">
            {earnings.map((e) => (
              <li key={`${e.teamId}-${e.currency}`} className="grid gap-0.5 py-2.5">
                <p className="font-medium">{e.teamName}</p>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {formatMinor(e.availableMinor, e.currency)} to request — {formatMinor(e.reservedMinor, e.currency)} on its way —{" "}
                  {formatMinor(e.paidOutMinor, e.currency)} paid out
                </p>
              </li>
            ))}
          </ul>
        )}
      </Block>
      <Block title="Sell your services" href="/new/services-team" linkLabel="Create a seller page">
        <p className="text-sm text-muted-foreground">
          Open a seller page of your own, alone or with a team, when you want clients to request and pay for your work.
        </p>
      </Block>
    </main>
  );
}
