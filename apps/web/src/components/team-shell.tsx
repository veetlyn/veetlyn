"use client";

import type { SectionPage } from "@jendal-workspace/core/context/node";
import { cn } from "@jendal-workspace/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  FolderKanban,
  HandCoins,
  Inbox,
  LifeBuoy,
  type LucideIcon,
  Package,
  Settings,
  ShieldAlert,
  Store,
  Tag,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import AppFrame, { navItemClass } from "@/components/app-frame";
import RecentCalls from "@/components/recent-calls";
import BillingNotice from "@/components/billing-notice";
import ProjectNav from "@/components/project-nav";
import { useMyWorkspaces } from "@/hooks/use-my-workspaces";
import { workspaceDestination, workspaceDestinations } from "@/lib/workspaces";
import { type HideableArea, projectStatusLabel } from "@jendal-workspace/core";
import { trpc } from "@/utils/trpc";
import { isProjectReadDenied } from "@/lib/project-refresh";

const PAGES = {
  requests: { label: "Requests", icon: HandCoins },
  projects: { label: "Projects", icon: FolderKanban },
  payments: { label: "Payments", icon: ArrowDownToLine },
  payouts: { label: "Payouts", icon: ArrowUpFromLine },
  cases: { label: "Disputes", icon: ShieldAlert },
  services: { label: "Services", icon: Tag },
  products: { label: "Premade items", icon: Package },
  orders: { label: "Orders", icon: Inbox },
  preview: { label: "Seller page", icon: Store },
  members: { label: "Team & access", icon: Users },
  settings: { label: "Settings", icon: Settings },
} satisfies Record<SectionPage, { label: string; icon: LucideIcon }>;


// The pages a limit can hide. A single project is decided by the server, by its stage.
const AREA_OF_PAGE = new Map<string, HideableArea>([
  ["requests", "requests"],
  ["projects", "projects"],
  ["services", "storefront"],
  ["products", "storefront"],
  ["orders", "storefront"],
  ["preview", "storefront"],
  ["from-ai", "storefront"],
]);

// Store pages that work for a store today; the others still read services-team data.
const STORE_PAGES: ReadonlySet<SectionPage> = new Set(["products"]);

const SEGMENT_LABELS = new Map<string, string>([
  ["finances", "Finances"],
  ["categories", "Categories"],
  ["departments", "Categories"],
  ...Object.entries(PAGES).map(([page, { label }]): [string, string] => [page, label]),
  ["rules", "Rules"],
  ["operating-model", "Operating model"],
  ["channels", "Channels"],
  ["new", "New"],
  ["from-ai", "From AI"],
]);

// The frame around every seller page (calls design §6): the seller's sections on the tray, the page on a framed canvas,
// and the assistant at the foot of every page. What the sidebar lists comes from the seller's node: its product, the
// workspace's plan and the person's role.
export default function TeamShell({
  slug,
  children,
}: {
  slug: string;
  kind?: "services" | "store";
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const seller = useQuery({ ...trpc.agent.seller.queryOptions({ slug }), retry: false, meta: { silent: true } });
  const scope = seller.data?.scope;
  const services = scope?.seller?.role.product === "services";
  const teamId = scope?.seller?.id ?? "";
  const calls = useQuery({
    ...trpc.agent.calls.queryOptions({ node: { kind: "seller", teamId } }),
    enabled: teamId !== "" && seller.data?.available === true,
    retry: false,
    meta: { silent: true },
  });

  const name = scope?.seller?.name ?? slug.replace(/-/g, " ");
  const workspaces = useMyWorkspaces();
  const organization = workspaces.find((w) => [...w.servicesTeams, ...w.stores].some((s) => s.slug === slug));
  const sections = (scope?.seller?.sections ?? [])
    .map((s) => ({ ...s, pages: services ? s.pages : s.pages.filter((p) => STORE_PAGES.has(p)) }))
    .filter((s) => s.pages.length > 0);
  const allowed = new Set(sections.flatMap((s) => s.pages));
  const projectsList = useQuery({
    ...trpc.project.list.queryOptions({ teamSlug: slug }),
    enabled: services && (allowed.has("projects") || allowed.has("requests")),
    retry: false,
    meta: { silent: true },
  });

  const segments = pathname.split("/").filter(Boolean).slice(1);
  const projectId = segments[0] === "projects" && segments[1] && segments[1] !== "new" ? segments[1] : null;
  const projectDetail = useQuery({
    ...trpc.project.get.queryOptions({ teamSlug: slug, projectId: projectId ?? "" }),
    enabled: services && projectId !== null,
    retry: false,
    meta: { silent: true },
  });
  const record = isProjectReadDenied(projectDetail.error) ? undefined : projectDetail.data?.project;
  const projectParent = allowed.has("projects")
    ? { href: `/${slug}/projects`, label: "Projects", allLabel: "All projects" }
    : allowed.has("requests") || allowed.has("orders")
      ? { href: `/${slug}/orders`, label: "Orders", allLabel: "All orders" }
      : { href: `/${slug}`, label: "Home", allLabel: "Home" };
  const hiddenArea = projectId ? undefined : AREA_OF_PAGE.get(segments[0] ?? "");
  const hidden = scope?.seller?.access.hidden ?? [];
  // Orders also lists service requests, so it is hidden only when both of its sources are.
  const pageHidden = services && (segments[0] === "orders"
    ? hidden.includes("storefront") && hidden.includes("requests")
    : hiddenArea !== undefined && hidden.includes(hiddenArea));

  const teamKind = services ? "Services team" : "Store";
  // A workspace is the organization (members, billing); this store or services team is one of its teams.
  const teamsHere = organization ? [
    ...organization.servicesTeams.map((t) => ({ slug: t.slug, name: t.name, kind: "Services team" })),
    ...organization.stores.map((s) => ({ slug: s.slug, name: s.name, kind: "Store" })),
  ] : [];
  const currentWorkspace = organization
    ? { ...workspaceDestination(organization), detail: name }
    : { href: `/${slug}`, label: name, detail: teamKind };
  // The sidebar switches workspace; the canvas names its module and record, not another seller level.
  const crumbs = segments[0] === "payouts" && segments[1] === "rules" ? [
      { href: `/${slug}/settings`, label: "Settings" },
      { href: `/${slug}/payouts/rules`, label: "Payout rules" },
    ] : projectId ? [
      { href: projectParent.href, label: projectParent.label },
      {
        href: `/${slug}/projects/${projectId}`,
        label: record?.title ?? (projectDetail.isError ? "Project unavailable" : "Loading project…"),
        menuLabel: projectParent.label,
        options: record ? [
          { href: projectParent.href, label: projectParent.allLabel },
          ...(projectsList.data ?? []).map((project) => ({ href: `/${slug}/projects/${project.id}`, label: project.title, detail: [project.clientName, projectStatusLabel(project.status)].filter(Boolean).join(" · ") })),
        ] : undefined,
      },
    ] : segments.length ? segments.map((segment, i) => ({
      href: `/${slug}/${segments.slice(0, i + 1).join("/")}`,
      label: (segment === "threads" ? "Threads" : SEGMENT_LABELS.get(segment)) ?? (i > 0 && segments[i - 1] === "projects" ? "Project" : i > 0 && segments[i - 1] === "payouts" ? "Payout" : "Details"),
    })) : [{ href: `/${slug}`, label: "Overview" }];
  const recent = (calls.data?.calls ?? []).slice(0, 5);

  // Five places on the sidebar; each place's pages are tabs on the top bar.
  const has = (page: SectionPage) => allowed.has(page);
  const places: { label: string; icon: LucideIcon; disabled?: boolean; tabs: { href: string; label: string }[] }[] = [
    { label: "Work", icon: FolderKanban, tabs: [
      { href: `/${slug}`, label: "Overview" },
      ...(has("projects") ? [{ href: `/${slug}/projects`, label: PAGES.projects.label }] : []),
      ...(has("orders") || has("requests") ? [{ href: `/${slug}/orders`, label: PAGES.orders.label }] : []),
    ] },
    { label: "Support", icon: LifeBuoy, disabled: true, tabs: [] },
    { label: "Catalog", icon: Store, tabs: [
      ...(["services", "products"] as const).filter(has).map((page) => ({ href: `/${slug}/${page}`, label: PAGES[page].label })),
      ...(services && has("services") ? [{ href: `/${slug}/categories`, label: "Categories" }] : []),
      ...(has("preview") ? [{ href: `/${slug}/preview`, label: PAGES.preview.label }] : []),
    ] },
    { label: "Finances", icon: Wallet, tabs: [
      ...(has("payments") ? [{ href: `/${slug}/finances`, label: "Overview" }] : []),
      ...(["payments", "payouts", "cases"] as const).filter(has).map((page) => ({ href: `/${slug}/${page}`, label: PAGES[page].label })),
    ] },
    { label: "Settings", icon: Settings, tabs: [
      ...(has("settings") ? [
        { href: `/${slug}/settings`, label: "General" },
        { href: `/${slug}/settings/operating-model`, label: "Operating model" },
        { href: `/${slug}/settings/channels`, label: "Channels" },
      ] : []),
      ...(has("members") ? [{ href: `/${slug}/members`, label: PAGES.members.label }] : []),
      ...(services && scope?.seller?.role.role === "admin" ? [{ href: `/${slug}/payouts/rules`, label: "Payout rules" }] : []),
    ] },
  ];
  // The deepest tab that contains this page decides the place (payout rules sit in Settings, not under Payouts).
  const matches = (href: string) => href === `/${slug}` ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const currentTab = places.flatMap((place) => place.tabs.map((tab) => ({ place, tab })))
    .filter(({ tab }) => matches(tab.href))
    .sort((a, b) => b.tab.href.length - a.tab.href.length)[0];
  const tabsHere = currentTab && currentTab.tab.href === pathname && currentTab.place.tabs.length > 1 ? currentTab.place.tabs : undefined;

  const pageLinks = [
    { href: `/${slug}`, label: "Home" },
    ...sections.flatMap((s) => s.pages.map((p) => ({ href: `/${slug}/${p}`, label: PAGES[p].label }))),
  ];

  return (
    <AppFrame
      fill={pathname.startsWith(`/${slug}/threads`)}
      workspace={{ ...currentWorkspace, options: [
        ...(teamsHere.length > 1 ? teamsHere.map((team) => ({ href: `/${team.slug}`, label: team.name, detail: team.kind })) : []),
        ...(organization?.canCreateStores ? [{ href: `/w/${organization.id}/billing`, label: "Workspace billing" }] : []),
        { href: "/", label: "Personal" },
        ...workspaceDestinations(workspaces),
      ] }}
      crumbs={crumbs}
      searchItems={[
        ...pageLinks.map((l) => ({ ...l, detail: name })),
        ...recent.map((c) => ({ href: `/${slug}/threads?thread=${c.id}`, label: c.title, group: "Threads" })),
        ...workspaceDestinations(workspaces).map((w) => ({ ...w, group: "Workspaces" })),
      ]}
      tabs={tabsHere}
      activeTab={currentTab?.tab.href}
      sidebar={
        projectId && services && teamId ? (
          <ProjectNav
            slug={slug}
            projectId={projectId}
            teamId={teamId}
            backHref={projectParent.href}
            backLabel={projectParent.label}
            agentAvailable={seller.data?.available === true}
          />
        ) : (
          <>
          <nav aria-label="Places" className="grid gap-0.5 pt-2">
            {places.map((place) => {
              const Icon = place.icon;
              if (place.disabled) {
                return (
                  <span key={place.label} aria-disabled="true" className={cn(navItemClass(false), "pointer-events-none opacity-55")}>
                    <Icon aria-hidden="true" />
                    {place.label}
                    <span className="ml-auto rounded-full bg-foreground/[0.06] px-1.5 text-[12px] leading-5 text-muted-foreground">Soon</span>
                  </span>
                );
              }
              const first = place.tabs[0];
              if (!first) return null;
              const active = currentTab?.place === place;
              return (
                <Link key={place.label} href={first.href} aria-current={active ? "page" : undefined} className={navItemClass(active)}>
                  <Icon aria-hidden="true" />
                  {place.label}
                </Link>
              );
            })}
          </nav>
          {services && seller.data?.available ? <RecentCalls calls={calls.data?.calls ?? []} callsPath={`/${slug}/threads`} /> : null}
          </>
        )
      }
      banner={
        <>
          <BillingNotice slug={slug} />

        </>
      }
    >
      {pageHidden ? (
        <main className="mx-auto w-full max-w-3xl space-y-3 px-4 py-6 md:px-7 md:py-8">
          <h1 className="font-heading text-3xl">This page isn’t available to you</h1>
          <p className="text-sm text-muted-foreground">An admin of {name} can change what you have access to.</p>
          <Link href={`/${slug}`} className="text-sm underline underline-offset-4">
            Back to Home
          </Link>
        </main>
      ) : (
        children
      )}
    </AppFrame>
  );
}
