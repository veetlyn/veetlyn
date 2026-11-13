"use client";

import { formatMoney, type MoneyCurrency, money, servicesTeamSetupSteps } from "@jendal-workspace/core";
import { Button, buttonVariants } from "@jendal-workspace/ui/components/button";
import { cn } from "@jendal-workspace/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef } from "react";

import { AgentIcon } from "@/components/agent-icon";

import TurnOffStoreButton from "@/components/catalog/turn-off-store-button";
import { Figure } from "@/components/figure";
import { Frame } from "@/components/frame";
import Loader from "@/components/loader";
import PayPalConnectCard from "@/components/paypal-connect-card";
import PublishCard from "@/components/seller-page/publish-card";
import TeamNotFound from "@/components/services-team/team-not-found";
import SetupChecklist from "@/components/setup-checklist";
import { SERVICES_TEAM_ROLE_LABELS } from "@/lib/services-team-labels";
import { type StoreUrlParts, storeUrl } from "@/lib/store-url";
import AskBar from "@/components/ask-bar";
import { usePlatformName } from "@/components/platform-name";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

const HOUR_MS = 3_600_000;
const MAX_DRAFTS_PER_VISIT = 3;
const quiet = { retry: false, meta: { silent: true } } as const;

type Need = {
  key: string;
  title: string;
  detail: string;
  amount?: string;
  href: string;
  action: string;
  primary?: boolean;
};

// Sums per currency, so two currencies are never added together.
function totals(rows: { currency: MoneyCurrency; amountMinor: number }[]): string {
  const byCurrency = new Map<MoneyCurrency, number>();
  for (const row of rows) byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? 0) + row.amountMinor);
  if (byCurrency.size === 0) return formatMoney(money("USD", 0));
  return [...byCurrency].map(([currency, minor]) => formatMoney(money(currency, minor))).join(" + ");
}

function answerBy(respondBy: string | null, now: number): string {
  if (!respondBy) return "No answer deadline";
  const hours = Math.ceil((Date.parse(respondBy) - now) / HOUR_MS);
  if (hours <= 0) return "Expiring now";
  return hours === 1 ? "Answer within 1 hour" : `Answer within ${hours} hours`;
}

// The seller's home (calls design §6): the assistant's account of what needs the person, built only from the team's records,
// the money that moved, and beside it the setup, the seller page, PayPal and the store.
export default function ServicesTeamDashboard({
  teamSlug,
  urlParts,
  embedded = false,
}: {
  teamSlug: string;
  urlParts: StoreUrlParts;
  // Beside a call the home shows without its own composer: the conversation is the composer.
  embedded?: boolean;
}) {
  const queryClient = useQueryClient();
  const platform = usePlatformName();
  const { data: session } = authClient.useSession();
  const result = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), ...quiet });
  const role = result.data?.role;
  const admin = role === "admin";
  const solo = result.data?.settings?.solo ?? false;
  const projects = useQuery({ ...trpc.project.list.queryOptions({ teamSlug }), enabled: result.isSuccess, ...quiet });
  const requests = useQuery({
    ...trpc.project.openRequests.queryOptions({ teamSlug }),
    enabled: result.isSuccess && !solo && !result.data.access.hidden.includes("requests"),
    ...quiet,
  });
  const payouts = useQuery({ ...trpc.payouts.list.queryOptions({ teamSlug }), enabled: admin && !solo, ...quiet });
  const payments = useQuery({ ...trpc.money.payments.queryOptions({ teamSlug }), enabled: admin, ...quiet });
  // Members who take work accept the published member agreement first; an admin accepts it by publishing.
  const rules = useQuery({
    ...trpc.rules.state.queryOptions({ teamSlug }),
    enabled: result.isSuccess && !admin,
    ...quiet,
  });
  const prepared = useQuery({
    ...trpc.agent.pending.queryOptions({ node: { kind: "seller", teamId: result.data?.team.id ?? "" } }),
    enabled: result.isSuccess,
    ...quiet,
  });
  const teamId = result.data?.team.id;
  const drafting = useMutation(
    trpc.agent.prepareDrafts.mutationOptions({
      onSuccess: ({ drafted }) => {
        if (!drafted || !teamId) return;
        void queryClient.invalidateQueries({ queryKey: trpc.agent.pending.queryKey() });
        void queryClient.invalidateQueries({ queryKey: trpc.agent.calls.queryKey() });
        // One request at a time; a page visit prepares a few at most.
        draftsThisVisit.current += 1;
        if (draftsThisVisit.current < MAX_DRAFTS_PER_VISIT) drafting.mutate({ teamId });
      },
      meta: { silent: true },
    }),
  );
  const draftsThisVisit = useRef(0);
  const started = useRef(false);
  const requestCount = projects.data?.filter((p) => p.status === "quoting").length ?? 0;
  useEffect(() => {
    if (started.current || !teamId || requestCount === 0) return;
    started.current = true;
    drafting.mutate({ teamId });
  }, [teamId, requestCount, drafting]);
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

  const { team, settings, offeringCount, productCount, payoutCredentialsSaved } = result.data;
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
      linkDiscord: `/${team.slug}/settings/channels`,
      payoutCredentials: `/${team.slug}/payouts`,
    },
  );
  const url = storeUrl(team.slug, urlParts);
  const setupDone = steps.every((step) => step.done);

  const now = Date.now();
  const toApprove = (payouts.data?.payouts ?? []).filter(
    (p) => p.status === "requested" && p.approvalsNeeded > 0 && p.eligibleApprovers > 0,
  );
  const toAnswer = requests.data ?? [];
  const toDeliver = (projects.data ?? []).filter((p) => p.status === "in_progress");
  const onClients = (projects.data ?? []).filter(
    (p) => p.status === "awaiting_deposit" || p.status === "delivered" || p.status === "awaiting_balance",
  );
  const hasPrepared = (prepared.data?.pending.length ?? 0) > 0;
  const needs: Need[] = [
    ...(rules.data?.memberAccepted === false
      ? [
          {
            key: "agreement",
            title: `Accept version ${rules.data.published.version} of the member agreement`,
            detail: "You take new work once you have accepted it.",
            href: `/${teamSlug}/settings/operating-model#published-rules`,
            action: "Review",
            primary: true,
          },
        ]
      : []),
    ...(toApprove.length > 0
      ? [
          {
            key: "payouts",
            title:
              toApprove.length === 1
                ? `Approve ${toApprove[0]?.memberName}'s payout`
                : `Approve ${toApprove.length} payouts`,
            detail:
              toApprove.length === 1
                ? (toApprove[0]?.projectTitle ?? "Balance payout")
                : toApprove.map((p) => p.memberName).join(", "),
            amount: totals(toApprove),
            href: `/${team.slug}/payouts`,
            action: "Review",
            primary: true,
          },
        ]
      : []),
    ...toAnswer.slice(0, 3).map((r) => ({
      key: `request-${r.id}`,
      title: `Answer “${r.title}”`,
      detail: answerBy(r.respondBy, now),
      href: `/${team.slug}/projects/${r.id}`,
      action: "Open",
    })),
    ...toDeliver.slice(0, 3).map((p) => ({
      key: `deliver-${p.id}`,
      title: `Deliver “${p.title}”`,
      detail: p.clientName ? `In progress for ${p.clientName}` : "In progress",
      href: `/${team.slug}/projects/${p.id}`,
      action: "Open",
    })),
  ];
  const loading = projects.isLoading || requests.isLoading || payouts.isLoading;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const paidThisMonth = (payments.data ?? []).filter(
    (p) => p.status === "captured" && p.capturedAt && Date.parse(p.capturedAt) >= monthStart,
  );
  const headline = loading
    ? "Looking at what needs you…"
    : needs.length === 0
      ? "Nothing needs you right now."
      : needs.length === 1
        ? "One thing needs you."
        : `${needs.length} things need you.`;

  const firstName = session?.user.name.split(/\s+/)[0] ?? "";
  const hero = embedded ? null : (
    <section
      aria-label={`Ask ${platform}`}
      className="mx-auto grid w-full max-w-[660px] gap-4 pt-6 pb-4 text-center md:pt-8"
    >
      <p className="text-sm text-muted-foreground">{firstName ? `Hello, ${firstName}` : "Welcome back"}</p>
      <h1 className="font-heading text-3xl leading-[1.15] tracking-[-0.03em]">
        What’s next for {team.name}?
      </h1>
      <AskBar
        callsPath={`/${team.slug}/threads`}
        node={{ kind: "seller", teamId: team.id }}
        placeholder={`Ask ${platform} to draft a quote, chase a client or check payouts`}
        hero={{
          scope: team.name,
          suggestions: [
            { label: "Catch me up", message: `What needs my attention at ${team.name} today?` },
            { label: "Draft a quote", message: "Help me draft a quote for a new request." },
            admin && !solo
              ? { label: "Review payouts", message: "Review the payouts that need my approval." }
              : { label: "Plan my week", message: "What should I work on first this week?" },
          ],
        }}
      />
    </section>
  );

  return (
    <main className="mx-auto w-full min-w-0 max-w-[724px] px-4 pb-12 text-sm md:px-8">
      {hero}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-10 pt-6">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6">
          {embedded ? (
            <header className="grid gap-2">
              <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <AgentIcon className="size-4 shrink-0" />
                <span>
                  <b className="font-semibold text-foreground">{platform}</b> for {team.name},{" "}
                  {SERVICES_TEAM_ROLE_LABELS[role ?? "admin"] ?? role}
                </span>
              </p>
              {embedded ? (
                <h1 className="font-heading text-3xl leading-[1.1] tracking-[-0.03em]">{headline}</h1>
              ) : (
                <h2 className="font-heading text-[22px] leading-[1.15] tracking-[-0.02em]">{headline}</h2>
              )}
              <p className="text-sm text-muted-foreground">
                {solo ? "Selling as just me" : "Selling as a team"} on{" "}
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-border underline-offset-4 hover:text-foreground"
                >
                  {url.replace(/^https?:\/\//, "")}
                </a>
              </p>
            </header>
          ) : null}

          {drafting.isPending ? (
            <p role="status" className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <AgentIcon className="size-4 shrink-0 motion-safe:animate-pulse" />
              {platform} is preparing a quote for your newest request…
            </p>
          ) : null}

          {projects.isError || requests.isError || payouts.isError ? (
            <div role="alert" className="panel space-y-2 p-4 text-sm">
              <p>Some work couldn’t be loaded. This list may be incomplete.</p>
              <Button variant="outline" size="sm" type="button" onClick={() => {
                if (projects.isError) void projects.refetch();
                if (requests.isError) void requests.refetch();
                if (payouts.isError) void payouts.refetch();
              }}>Try again</Button>
            </div>
          ) : null}

          {hasPrepared ? (
            <Frame
              icon={<AgentIcon className="size-4 shrink-0" />}
              title={`Prepared by ${platform}, waiting for you`}
              count={prepared.data?.pending.length}
            >
              <ul className="min-w-0 divide-y">
                {prepared.data?.pending.map((item, index) => (
                  <li key={item.id} className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-3.5 sm:flex-nowrap">
                    <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                      <p className="break-words font-medium">{item.card.title}</p>
                      {item.note ? <p className="mt-1 line-clamp-2 break-words text-sm text-muted-foreground">{item.note}</p> : null}
                    </div>
                    {item.card.kind === "quote" ? <span className="font-tabular font-semibold">{item.card.total}</span> : null}
                    {item.card.kind === "payout" ? <span className="font-tabular font-semibold">{item.card.amount}</span> : null}
                    <Link
                      href={`/${team.slug}/threads?thread=${item.callId}`}
                      className={cn(buttonVariants({ variant: index === 0 ? "default" : "outline", size: "sm" }), "ml-auto shrink-0 px-4 sm:ml-0")}
                    >
                      Review
                    </Link>
                  </li>
                ))}
              </ul>
            </Frame>
          ) : null}

          {needs.length > 0 ? (
            <Frame title="Needs you" count={needs.length}>
              <ul className="min-w-0 divide-y">
                {needs.map((need, index) => (
                  <li key={need.key} className="flex min-w-0 flex-wrap items-center gap-3 px-4 py-3.5 sm:flex-nowrap">
                    <div className={cn("min-w-0 flex-1", need.amount && "basis-full sm:basis-auto")}>
                      <p className="break-words font-medium">{need.title}</p>
                      <p className="break-words text-sm text-muted-foreground">{need.detail}</p>
                    </div>
                    {need.amount ? <span className="font-tabular font-semibold">{need.amount}</span> : null}
                    <Link
                      href={need.href}
                      className={cn(
                        // One mint key on the screen: the first prepared item, else the first thing that needs you. Money
                        // waiting on a decision is the onyx key; routine opens stay grey.
                        buttonVariants({ variant: index === 0 && !hasPrepared ? "default" : need.amount ? "dark" : "outline", size: "sm" }),
                        "ml-auto shrink-0 sm:ml-0",
                        need.primary && "px-4",
                      )}
                    >
                      {need.action}
                    </Link>
                  </li>
                ))}
              </ul>
            </Frame>
          ) : !loading ? (
            <Frame title="Needs you" bodyClassName="p-4">
              <p className="text-sm text-muted-foreground">Nothing needs you right now.</p>
            </Frame>
          ) : <p role="status" className="text-sm text-muted-foreground">Looking at what needs you…</p>}

          {onClients.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              Waiting on clients: {onClients.length === 1 ? "1 project" : `${onClients.length} projects`} (
              {(
                [
                  ["awaiting_deposit", "deposit due", "deposits due"],
                  ["delivered", "delivery to review", "deliveries to review"],
                  ["awaiting_balance", "balance due", "balances due"],
                ] as const
              )
                .map(([status, one, many]) => ({ n: onClients.filter((p) => p.status === status).length, one, many }))
                .filter(({ n }) => n > 0)
                .map(({ n, one, many }) => `${n} ${n === 1 ? one : many}`)
                .join(", ")}
              ).{" "}
              <Link
                href={`/${team.slug}/projects`}
                className="underline decoration-border underline-offset-4 hover:text-foreground"
              >
                See projects
              </Link>
            </p>
          ) : null}

          <section aria-label="Figures" className="grid gap-3 sm:grid-cols-3">
            {admin ? (
              <Figure
                label="Paid this month"
                value={payments.isPending ? "…" : payments.isError ? "Unavailable" : totals(paidThisMonth)}
                note={payments.isPending ? "Loading payments" : payments.isError ? "Check Finances" : paidThisMonth.length === 1 ? "1 payment" : `${paidThisMonth.length} payments`}
              />
            ) : null}
            {admin && !solo ? (
              <Figure
                label="Payouts to approve"
                value={payouts.isPending ? "…" : payouts.isError ? "Unavailable" : totals(toApprove)}
                note={payouts.isPending ? "Loading payouts" : payouts.isError ? "Check Finances" : toApprove.length === 1 ? "1 request" : `${toApprove.length} requests`}
              />
            ) : null}
            <Figure
              label="In progress"
              value={projects.isPending ? "…" : projects.isError ? "Unavailable" : String(toDeliver.length)}
              note={toDeliver.length === 1 ? "project" : "projects"}
            />
          </section>
        </div>

        {admin && !setupDone ? (
          <section aria-labelledby="setup-h" className="grid min-w-0 gap-3 border-t pt-6">
            <h2 id="setup-h" className="text-sm font-medium">Finish setup</h2>
          <SetupChecklist
            steps={steps}
            title={
              setupDone
                ? solo
                  ? "Your seller page is set up"
                  : "Your team is set up"
                : solo
                  ? "Set up your seller page"
                  : "Set up your team"
            }
          />
          </section>
        ) : null}
        {admin ? (
          <section aria-labelledby="manage-h" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 border-t pt-6">
            <h2 id="manage-h" className="text-sm font-medium">Seller page and payments</h2>
          <PublishCard teamSlug={team.slug} publicUrl={url} />
          <PayPalConnectCard teamId={team.id} />
          <section className="frame frame-panel">
            <div className="frame-head">
              <h2 className="font-medium">Store</h2>
              {settings?.storeEnabled ? (
                <div className="ml-auto flex gap-3">
                  <Link href={`/${team.slug}/products`} className="underline decoration-border underline-offset-4">
                    Premade items
                  </Link>
                  {admin ? (
                    <Link href={`/${team.slug}/orders`} className="underline decoration-border underline-offset-4">
                      Orders
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="frame frame-body grid gap-2 p-4">
              <p className="text-sm text-muted-foreground">
                Sell digital downloads, such as presets, templates and icons, from your seller page. Files can be up to
                100 MB.
              </p>
              {!settings?.storeEnabled ? (
                <div className="grid justify-items-start gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => enable.mutate({ teamSlug: team.slug, enabled: true })}
                    disabled={!admin || enable.isPending}
                  >
                    {enable.isPending ? "Turning on…" : "Turn on the store"}
                  </Button>
                  {!admin ? (
                    <p className="text-sm text-muted-foreground">Only an admin can turn on the store.</p>
                  ) : null}
                  {enable.error ? (
                    <p role="alert" className="text-sm text-destructive">
                      {enable.error.message}
                    </p>
                  ) : null}
                </div>
              ) : admin ? (
                <TurnOffStoreButton teamSlug={team.slug} />
              ) : null}
            </div>
          </section>
          </section>
        ) : null}
      </div>
    </main>
  );
}
