"use client";

import { servicesTeamSetupSteps } from "@jendal-workspace/core";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import Loader from "@/components/loader";
import ComingSoon from "@/components/services-team/coming-soon";
import TeamNotFound from "@/components/services-team/team-not-found";
import SetupChecklist from "@/components/setup-checklist";
import { SERVICES_TEAM_ROLE_LABELS } from "@/lib/services-team-labels";
import { trpc } from "@/utils/trpc";

export default function ServicesTeamDashboard({ teamSlug }: { teamSlug: string }) {
  const result = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false });

  if (result.isPending) return <Loader />;
  if (result.isError) return <TeamNotFound />;

  const { team, role, settings } = result.data;
  const steps = servicesTeamSetupSteps(
    { paypalMerchantId: team.paypalMerchantId, settingsSaved: settings?.settingsSavedAt != null },
    { settings: `/${team.slug}/settings` },
  );

  return (
    <main className="container mx-auto max-w-3xl space-y-6 px-4 py-6">
      <div className="space-y-1">
        <Link href="/" className="text-sm text-muted-foreground">
          Your workspace
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{team.name}</h1>
      </div>
      <nav aria-label="Services team" className="flex gap-4 text-sm">
        <Link href={`/${team.slug}/settings`} className="underline underline-offset-4">
          Settings
        </Link>
        <Link href={`/${team.slug}/members`} className="underline underline-offset-4">
          Members
        </Link>
      </nav>
      <SetupChecklist steps={steps} title="Set up your team" />
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Your role</dt>
        <dd>{SERVICES_TEAM_ROLE_LABELS[role] ?? role}</dd>
        <dt className="text-muted-foreground">PayPal</dt>
        <dd>{team.paypalMerchantId ?? "Not connected"}</dd>
      </dl>
      <ComingSoon title="Projects" />
      <ComingSoon title="Payouts" />
    </main>
  );
}
