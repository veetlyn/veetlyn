"use client";

import { canServicesTeam } from "@jendal-workspace/core";
import { buttonVariants } from "@jendal-workspace/ui/lib/button-variants";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import Loader from "@/components/loader";
import { PlatformName } from "@/components/platform-name";
import TeamNotFound from "@/components/services-team/team-not-found";
import { trpc } from "@/utils/trpc";

import { PayoutCredentialsCard } from "./payout-credentials-card";
import { PayoutRequestsTable } from "./payout-requests-table";
import { PayoutsWebSection } from "./payouts-web-section";

export default function TeamPayouts({ teamSlug, viewerId }: { teamSlug: string; viewerId: string }) {
  const result = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });

  if (result.isPending) return <Loader />;
  if (result.isError) return <TeamNotFound />;

  const { team, role, settings, access } = result.data;
  const solo = settings?.solo ?? false;

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 md:px-7 md:py-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-heading text-3xl">Payouts</h1>
          {!solo ? <p className="text-sm text-muted-foreground">Members&apos; payout requests, paid from {team.name}&apos;s PayPal account.</p> : null}
        </div>
        {!solo && canServicesTeam(role, "approve_payouts") ? (
          <Link href={`/${team.slug}/payouts/rules`} className={buttonVariants({ variant: "outline" })}>
            Payout rules
          </Link>
        ) : null}
      </header>
      {solo ? (
        <p className="text-sm text-muted-foreground">
          Payouts are for teams. As a solo seller, clients pay you directly in your PayPal account.
        </p>
      ) : !canServicesTeam(role, "approve_payouts") && !access.moneyViewer ? (
        <p className="text-sm text-muted-foreground">
          Only an admin can manage payouts. You can ask for a payout of your own earnings on{" "}
          <Link href="/me/payouts" className="underline underline-offset-4">
            your Payouts page
          </Link>
          .
        </p>
      ) : (
        <>
          <PayoutRequestsTable teamSlug={team.slug} viewerId={viewerId} />
          {canServicesTeam(role, "approve_payouts") ? (
            <section aria-labelledby="payout-methods-heading" className="space-y-4">
              <div className="space-y-1">
                <h2 id="payout-methods-heading" className="font-heading text-lg">Ways to pay out</h2>
                <p className="text-sm text-muted-foreground">Send approved payouts automatically from <PlatformName />, or through PayPal&apos;s own Payouts page.</p>
              </div>
              <div className="grid items-start gap-4 xl:grid-cols-2">
                <PayoutCredentialsCard teamSlug={team.slug} />
                <PayoutsWebSection teamSlug={team.slug} />
              </div>
            </section>
          ) : <p className="text-sm text-muted-foreground">Read-only access. An admin handles approvals and sends.</p>}
        </>
      )}
    </main>
  );
}
