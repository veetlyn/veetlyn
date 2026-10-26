"use client";

import { servicesTeamSetupSteps } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";

import TurnOffStoreButton from "@/components/catalog/turn-off-store-button";
import Loader from "@/components/loader";
import PayPalConnectCard from "@/components/paypal-connect-card";
import PublishCard from "@/components/seller-page/publish-card";
import TeamNotFound from "@/components/services-team/team-not-found";
import SetupChecklist from "@/components/setup-checklist";
import { SERVICES_TEAM_ROLE_LABELS } from "@/lib/services-team-labels";
import { type StoreUrlParts, storeUrl } from "@/lib/store-url";
import { trpc } from "@/utils/trpc";

export default function ServicesTeamDashboard({ teamSlug, urlParts }: { teamSlug: string; urlParts: StoreUrlParts }) {
  const queryClient = useQueryClient();
  const result = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const enable = useMutation(
    trpc.servicesTeam.setStoreEnabled.mutationOptions({
      onSuccess: () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.get.queryKey({ teamSlug }) }),
          queryClient.invalidateQueries({ queryKey: trpc.seller.preview.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.seller.status.queryKey() }),
        ]),
    }),
  );

  if (result.isPending) return <Loader />;
  if (result.isError) return <TeamNotFound />;

  const { team, role, settings, offeringCount, productCount, payoutCredentialsSaved } = result.data;
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
      payoutCredentialsSaved,
    },
    {
      settings: `/${team.slug}/settings`,
      services: `/${team.slug}/services`,
      connectPaypal: "#paypal",
      publish: "#publish",
      linkDiscord: `/${team.slug}/discord`,
      payoutCredentials: `/${team.slug}/payouts`,
    },
  );

  const url = storeUrl(team.slug, urlParts);

  const sections = [
    { href: `/${team.slug}/projects`, title: "Projects", text: "Quotes, deliveries and payments for each client.", show: true },
    { href: `/${team.slug}/services`, title: "Services", text: "What you sell, with a usual price and time.", show: true },
    { href: `/${team.slug}/payouts`, title: "Payouts", text: "Members ask; your payout rules decide who approves.", show: !solo },
    { href: `/${team.slug}/members`, title: "Members", text: "Who is on the team, and their role.", show: !solo },
    { href: `/${team.slug}/payouts/rules`, title: "Payout rules", text: "Who approves payouts, how much and when they go out.", show: !solo && role === "admin" },
  ].filter((section) => section.show);
  const setupDone = steps.every((step) => step.done);

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 md:px-7 md:py-8">
      <header className="grid gap-1.5">
        <h1 className="font-heading text-3xl">{team.name}</h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <span>{SERVICES_TEAM_ROLE_LABELS[role] ?? role}</span>
          <span aria-hidden="true">·</span>
          <span>{solo ? "Selling as just me" : "Selling as a team"}</span>
          <span aria-hidden="true">·</span>
          <a href={url} target="_blank" rel="noreferrer" className="underline decoration-border underline-offset-4 hover:text-foreground">
            {url.replace(/^https?:\/\//, "")}
          </a>
        </p>
      </header>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-6">
          {!setupDone ? <SetupChecklist steps={steps} title={solo ? "Set up your seller page" : "Set up your team"} /> : null}
          <section aria-label="Sections" className="grid gap-3 sm:grid-cols-2">
            {sections.map((section) => (
              <Link
                key={section.href}
                href={section.href}
                className="group panel grid content-start gap-1 p-4 transition-shadow hover:shadow-[0_0_0_1px_var(--input)]"
              >
                <span className="flex items-center justify-between font-semibold">
                  {section.title}
                  <span aria-hidden="true" className="text-muted-foreground transition-transform group-hover:translate-x-0.5">→</span>
                </span>
                <span className="text-sm text-muted-foreground">{section.text}</span>
              </Link>
            ))}
          </section>
          {setupDone ? <SetupChecklist steps={steps} title={solo ? "Your seller page is set up" : "Your team is set up"} /> : null}
        </div>
        <aside className="grid gap-4">
          <PublishCard teamSlug={team.slug} publicUrl={url} />
          <PayPalConnectCard teamId={team.id} />
          <section className="panel grid gap-2 p-4">
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="font-semibold">Store</h2>
              {settings?.storeEnabled ? (
                <div className="flex gap-3 text-sm">
                  <Link href={`/${team.slug}/products`} className="underline decoration-border underline-offset-4">
                    Products
                  </Link>
                  {role === "admin" ? (
                    <Link href={`/${team.slug}/orders`} className="underline decoration-border underline-offset-4">
                      Orders
                    </Link>
                  ) : null}
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
                  variant="outline"
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
        </aside>
      </div>
    </main>
  );
}
