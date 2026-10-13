"use client";

import { canServicesTeam } from "@jendal-workspace/core";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import Loader from "@/components/loader";
import TeamNotFound from "@/components/services-team/team-not-found";
import { trpc } from "@/utils/trpc";

import { PayoutCredentialsCard } from "./payout-credentials-card";
import { PayoutRequestsTable } from "./payout-requests-table";

export default function TeamPayouts({ teamSlug }: { teamSlug: string }) {
  const result = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });

  if (result.isPending) return <Loader />;
  if (result.isError) return <TeamNotFound />;

  const { team, role, settings } = result.data;
  const solo = settings?.solo ?? false;

  return (
    <main className="container mx-auto max-w-4xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <Link href={`/${team.slug}`} className="text-sm text-muted-foreground">
          Team dashboard
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Payouts</h1>
      </div>
      {solo ? (
        <p className="text-sm text-muted-foreground">
          Payouts are for teams. As a solo seller, clients pay you directly in your PayPal account.
        </p>
      ) : !canServicesTeam(role, "approve_payouts") ? (
        <p className="text-sm text-muted-foreground">
          Only an admin can manage payouts. You can ask for a payout of your own earnings on{" "}
          <Link href="/me/payouts" className="underline underline-offset-4">
            your Payouts page
          </Link>
          .
        </p>
      ) : (
        <>
          <p className="text-sm">
            <Link href={`/${team.slug}/payouts/rules`} className="underline underline-offset-4">
              Payout rules
            </Link>
            <span className="text-muted-foreground">: who approves payouts, and when they are sent.</span>
          </p>
          <PayoutCredentialsCard teamSlug={team.slug} />
          <PayoutRequestsTable teamSlug={team.slug} />
        </>
      )}
    </main>
  );
}
