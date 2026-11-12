"use client";

import type { SectionPage } from "@jendal-workspace/core/context/node";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowLeft,
  CreditCard,
  FolderKanban,
  HandCoins,
  Inbox,
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

import { AgentIcon } from "@/components/agent-icon";
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
  products: { label: "Products", icon: Package },
  orders: { label: "Orders", icon: Inbox },
  preview: { label: "Seller page", icon: Store },
  members: { label: "People", icon: Users },
  settings: { label: "Settings", icon: Settings },
} satisfies Record<SectionPage, { label: string; icon: LucideIcon }>;

// Workspace modules are visible directly; server-authorized sections still decide which ones exist.
const PLACES: { label: string; icon: LucideIcon; pages: SectionPage[] }[] = [
  { label: "Work", icon: FolderKanban, pages: ["projects", "requests"] },
  { label: "Sell", icon: Store, pages: ["services", "products", "orders", "preview"] },
  { label: "Money", icon: Wallet, pages: ["payments", "payouts", "cases"] },
  { label: "Team", icon: Settings, pages: ["members", "settings"] },
];

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
  const settingsMode = segments[0] === "settings" || segments[0] === "members" || (segments[0] === "payouts" && segments[1] === "rules");
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
    : allowed.has("requests")
      ? { href: `/${slug}/requests`, label: "Requests", allLabel: "All requests" }
      : { href: `/${slug}`, label: "Home", allLabel: "Home" };
  const hiddenArea = projectId ? undefined : AREA_OF_PAGE.get(segments[0] ?? "");
  const pageHidden = services && hiddenArea !== undefined && scope?.seller?.access.hidden.includes(hiddenArea) === true;

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
  const crumbs = projectId ? [
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
      label: (segment === "calls" ? "Threads" : SEGMENT_LABELS.get(segment)) ?? (i > 0 && segments[i - 1] === "projects" ? "Project" : i > 0 && segments[i - 1] === "payouts" ? "Payout" : "Details"),
    })) : [{ href: `/${slug}`, label: "Overview" }];
  const isActive = (href: string) =>
    href === `/${slug}` ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const link = (href: string, label: string, Icon: React.ComponentType<{ className?: string }>) => (
    <Link
      key={href}
      href={href}
      aria-current={isActive(href) ? "page" : undefined}
      className={navItemClass(isActive(href))}
    >
      <Icon className="size-4" aria-hidden="true" />
      {label}
    </Link>
  );
  const recent = (calls.data?.calls ?? []).slice(0, 5);

  const pageLinks = [
    { href: `/${slug}`, label: "Home" },
    ...sections.flatMap((s) => s.pages.map((p) => ({ href: `/${slug}/${p}`, label: PAGES[p].label }))),
  ];

  return (
    <AppFrame
      fill={pathname.startsWith(`/${slug}/calls`)}
      workspace={{ ...currentWorkspace, options: [{ href: "/", label: "Personal" }, ...workspaceDestinations(workspaces)] }}
      crumbs={crumbs}
      searchItems={[
        ...pageLinks.map((l) => ({ ...l, detail: name })),
        ...recent.map((c) => ({ href: `/${slug}/calls?call=${c.id}`, label: c.title, group: "Threads" })),
        ...workspaceDestinations(workspaces).map((w) => ({ ...w, group: "Workspaces" })),
      ]}
      sidebar={
        <>
          {settingsMode ? (
            <nav aria-label="Workspace settings" className="grid gap-1">
              <Link href={`/${slug}`} className={navItemClass(false)}><ArrowLeft className="size-4" aria-hidden="true" /><span className="truncate">Back to {name}</span></Link>
              <h2 className="px-2.5 pt-4 pb-2 text-xs text-muted-foreground">Settings</h2>
              {[
                { href: `/${slug}/settings`, label: "General" },
                { href: `/${slug}/settings/operating-model`, label: "Operating model" },
                { href: `/${slug}/settings/channels`, label: "Channels" },
                ...(allowed.has("members") ? [{ href: `/${slug}/members`, label: "Team & access" }] : []),
                ...(services && scope?.seller?.role.role === "admin" ? [{ href: `/${slug}/payouts/rules`, label: "Payout rules" }] : []),
              ].map((item) => (
                <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} className={navItemClass(pathname === item.href)}>{item.label}</Link>
              ))}
            </nav>
          ) : projectId && services && teamId ? (
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
              {teamsHere.length > 1 && organization ? (
                <nav aria-label={`Teams in ${organization.name}`} className="mb-4 grid gap-0.5 border-b pb-4">
                  <h2 className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">Teams in this workspace</h2>
                  {teamsHere.map((team) => (
                    <Link key={team.slug} href={`/${team.slug}`} aria-current={team.slug === slug ? "true" : undefined} className={navItemClass(team.slug === slug)}>
                      <span className="truncate">{team.name}</span>
                      <span className="ml-auto text-xs text-muted-foreground">{team.kind}</span>
                    </Link>
                  ))}
                </nav>
              ) : null}
              <nav aria-label="Modules" className="grid gap-0.5">
                <Link href={`/${slug}`} aria-current={isActive(`/${slug}`) ? "page" : undefined} className={navItemClass(isActive(`/${slug}`))}>
                  <AgentIcon className="size-4" />
                  Overview
                </Link>
                {PLACES.map((place) => {
                  const pages = place.pages.filter((page) => allowed.has(page));
                  if (pages.length === 0) return null;
                  return (
                    <section key={place.label} className="pt-4">
                      <h2 className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">{place.label}</h2>
                      <div className="grid gap-0.5">
                        {pages.map((page) => link(`/${slug}/${page}`, PAGES[page].label, PAGES[page].icon))}
                        {place.label === "Sell" && services && allowed.has("services") ? (
                          <Link href={`/${slug}/from-ai`} aria-current={isActive(`/${slug}/from-ai`) ? "page" : undefined} className={navItemClass(isActive(`/${slug}/from-ai`))}>
                            <AgentIcon className="size-4" />
                            From AI
                          </Link>
                        ) : null}
                        {place.label === "Team" && organization?.canCreateStores ? link(`/w/${organization.id}/billing`, "Workspace billing", CreditCard) : null}
                      </div>
                    </section>
                  );
                })}
              </nav>
              {services ? <RecentCalls calls={recent} callsPath={`/${slug}/calls`} label="Your threads" /> : null}
            </>
          )}
        </>
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
