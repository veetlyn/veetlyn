"use client";

import { servicesTeamSetupSteps } from "@jendal-workspace/core";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import Loader from "@/components/loader";
import PayPalConnectCard from "@/components/paypal-connect-card";
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
    {
      paypalMerchantId: team.paypalMerchantId,
      settingsSaved: settings?.settingsSavedAt != null,
      discordGuildId: settings?.discordGuildId ?? null,
    },
    { settings: `/${team.slug}/settings`, connectPaypal: "#paypal", linkDiscord: `/${team.slug}/discord` },
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
        <Link href={`/${team.slug}/projects`} className="underline underline-offset-4">
          Projects
        </Link>
        <Link href={`/${team.slug}/settings`} className="underline underline-offset-4">
          Settings
        </Link>
        <Link href={`/${team.slug}/members`} className="underline underline-offset-4">
          Members
        </Link>
      </nav>
      <SetupChecklist steps={steps} title="Set up your team" />
      <PayPalConnectCard teamId={team.id} />
      <section className="grid gap-2 border p-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-medium">Projects</h2>
          <Link href={`/${team.slug}/projects`} className="text-sm underline underline-offset-4">
            Open projects
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          Start a project for a client, send quotes, and share a private link where they follow and pay.
        </p>
      </section>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Your role</dt>
        <dd>{SERVICES_TEAM_ROLE_LABELS[role] ?? role}</dd>
        <dt className="text-muted-foreground">PayPal</dt>
        <dd>{team.paypalMerchantId ?? "Not connected"}</dd>
      </dl>
      <ComingSoon title="Payouts" />
    </main>
  );
}
