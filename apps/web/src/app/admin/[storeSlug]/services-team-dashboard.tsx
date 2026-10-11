"use client";

import { servicesTeamSetupSteps } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";

import TurnOffStoreButton from "@/components/catalog/turn-off-store-button";
import Loader from "@/components/loader";
import PayPalConnectCard from "@/components/paypal-connect-card";
import PublishCard from "@/components/seller-page/publish-card";
import ComingSoon from "@/components/services-team/coming-soon";
import TeamNotFound from "@/components/services-team/team-not-found";
import SetupChecklist from "@/components/setup-checklist";
import { SERVICES_TEAM_ROLE_LABELS } from "@/lib/services-team-labels";
import { type StoreUrlParts, storeUrl } from "@/lib/store-url";
import { trpc } from "@/utils/trpc";

export default function ServicesTeamDashboard({ teamSlug, urlParts }: { teamSlug: string; urlParts: StoreUrlParts }) {
  const queryClient = useQueryClient();
  const result = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false });
  const enable = useMutation(
    trpc.servicesTeam.setStoreEnabled.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.get.queryKey({ teamSlug }) }),
    }),
  );

  if (result.isPending) return <Loader />;
  if (result.isError) return <TeamNotFound />;

  const { team, role, settings, offeringCount, productCount } = result.data;
  const solo = settings?.solo ?? false;
  const steps = servicesTeamSetupSteps(
    {
      status: team.status,
      paypalMerchantId: team.paypalMerchantId,
      settingsSaved: settings?.settingsSavedAt != null,
      discordGuildId: settings?.discordGuildId ?? null,
      solo,
      offeringCount,
      productCount,
    },
    {
      settings: `/${team.slug}/settings`,
      services: `/${team.slug}/services`,
      connectPaypal: "#paypal",
      publish: "#publish",
      linkDiscord: `/${team.slug}/discord`,
    },
  );

  const url = storeUrl(team.slug, urlParts);

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
        <Link href={`/${team.slug}/services`} className="underline underline-offset-4">
          Services
        </Link>
        {settings?.storeEnabled ? (
          <Link href={`/${team.slug}/products`} className="underline underline-offset-4">
            Products
          </Link>
        ) : null}
        {settings?.storeEnabled ? (
          <Link href={`/${team.slug}/orders`} className="underline underline-offset-4">
            Orders
          </Link>
        ) : null}
        <Link href={`/${team.slug}/settings`} className="underline underline-offset-4">
          Settings
        </Link>
        {!solo ? (
          <Link href={`/${team.slug}/members`} className="underline underline-offset-4">
            Members
          </Link>
        ) : null}
      </nav>
      <SetupChecklist steps={steps} title={solo ? "Set up your seller page" : "Set up your team"} />
      <PublishCard teamSlug={team.slug} publicUrl={url} />
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
      <section className="grid gap-2 border p-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-medium">Services</h2>
          <Link href={`/${team.slug}/services`} className="text-sm underline underline-offset-4">
            Open services
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          What you sell, with a usual price range and time. Clients pick one when they ask for a quote.
        </p>
      </section>
      <section className="grid gap-2 border p-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-medium">Store</h2>
          {settings?.storeEnabled ? (
            <div className="flex gap-4">
              <Link href={`/${team.slug}/products`} className="text-sm underline underline-offset-4">
                Open products
              </Link>
              <Link href={`/${team.slug}/orders`} className="text-sm underline underline-offset-4">
                Open orders
              </Link>
            </div>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          Sell digital downloads, such as presets, templates and icons, from your seller page. Files can be up to 100 MB.
        </p>
        {!settings?.storeEnabled ? (
          <div className="grid justify-items-start gap-2">
            <Button
              type="button"
              onClick={() => enable.mutate({ teamSlug: team.slug, enabled: true })}
              disabled={role !== "admin" || enable.isPending}
            >
              {enable.isPending ? "Turning on…" : "Turn on the store"}
            </Button>
            {role !== "admin" ? <p className="text-sm text-muted-foreground">Only an admin can turn on the store.</p> : null}
            {enable.error ? (
              <p role="alert" className="text-sm text-destructive">
                {enable.error.message}
              </p>
            ) : null}
          </div>
        ) : role === "admin" ? (
          <TurnOffStoreButton teamSlug={team.slug} />
        ) : null}
      </section>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Seller page</dt>
        <dd>
          <a href={url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            {url}
          </a>
        </dd>
        <dt className="text-muted-foreground">Your role</dt>
        <dd>{SERVICES_TEAM_ROLE_LABELS[role] ?? role}</dd>
        <dt className="text-muted-foreground">PayPal</dt>
        <dd>{team.paypalMerchantId ?? "Not connected"}</dd>
        <dt className="text-muted-foreground">Selling as</dt>
        <dd>{solo ? "Just me" : "A team"}</dd>
      </dl>
      {!solo ? <ComingSoon title="Payouts" /> : null}
    </main>
  );
}
