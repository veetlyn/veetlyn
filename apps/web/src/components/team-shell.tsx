"use client";

import type { ContextNode, SectionPage } from "@jendal-workspace/core/context/node";
import { cn } from "@jendal-workspace/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronRight,
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
import AskBar from "@/components/ask-bar";
import RecentCalls from "@/components/recent-calls";
import BillingNotice from "@/components/billing-notice";
import ProjectNav from "@/components/project-nav";
import { usePlatformName } from "@/components/platform-name";
import { sellerOptions, useMyWorkspaces, workspaceOptions } from "@/hooks/use-my-workspaces";
import { projectStatusLabel } from "@jendal-workspace/core";
import { trpc } from "@/utils/trpc";

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
  members: { label: "Team", icon: Users },
  settings: { label: "Settings", icon: Settings },
} satisfies Record<SectionPage, { label: string; icon: LucideIcon }>;

// The seller's sidebar: Home, then four places that open into a tree, one at a time. A place holding a single page for
// this person is a plain row.
const PLACES: { label: string; icon: LucideIcon; pages: SectionPage[] }[] = [
  { label: "Projects", icon: FolderKanban, pages: ["projects", "requests"] },
  { label: "Shop", icon: Store, pages: ["services", "products", "orders", "preview"] },
  { label: "Finances", icon: Wallet, pages: ["payments", "payouts", "cases"] },
  { label: "Settings", icon: Settings, pages: ["settings", "members"] },
];
const childLabel = (page: SectionPage) =>
  page === "projects" ? "All projects" : page === "requests" ? "Requests" : page === "settings" ? "General" : PAGES[page].label;
const RECENT_PROJECTS = 3;

// Store pages that work for a store today; the others still read services-team data.
const STORE_PAGES: ReadonlySet<SectionPage> = new Set(["products"]);

const SEGMENT_LABELS = new Map<string, string>([
  ...Object.entries(PAGES).map(([page, { label }]): [string, string] => [page, label]),
  ["rules", "Rules"],
  ["operating-model", "Operating model"],
  ["channels", "Channels"],
  ["new", "New"],
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
  const platform = usePlatformName();
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
    enabled: services && allowed.has("projects"),
    retry: false,
    meta: { silent: true },
  });
  const prepared = useQuery({
    ...trpc.agent.pending.queryOptions({ node: { kind: "seller", teamId } }),
    enabled: teamId !== "" && seller.data?.available === true,
    retry: false,
    meta: { silent: true },
  });

  const segments = pathname.split("/").filter(Boolean).slice(1);
  const projectId = segments[0] === "projects" && segments[1] && segments[1] !== "new" ? segments[1] : null;
  // Where the assistant starts from on this page: the project open here, or the whole seller.
  const node: ContextNode | null = !teamId
    ? null
    : projectId && services
      ? { kind: "record", teamId, record: { type: "project", id: projectId } }
      : { kind: "seller", teamId };

  // Workspace › seller › section › record. The workspace and seller crumbs switch; the sidebar lists the sections.
  const crumbs = [
    ...(organization
      ? [{ href: `/w/${organization.id}`, label: organization.name, options: workspaceOptions(workspaces), menuLabel: "Workspaces" }]
      : []),
    {
      href: `/${slug}`,
      label: name,
      options: organization ? sellerOptions(organization) : undefined,
      menuLabel: organization ? `Sellers in ${organization.name}` : undefined,
    },
    ...segments.map((segment, i) => ({
      href: `/${slug}/${segments.slice(0, i + 1).join("/")}`,
      label: (segment === "calls" ? "Threads" : SEGMENT_LABELS.get(segment)) ?? (i > 0 && segments[i - 1] === "projects" ? "Project" : "Details"),
    })),
  ];
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
      crumbs={crumbs}
      chatsPath={services ? `/${slug}/calls` : undefined}
      searchItems={[
        ...pageLinks.map((l) => ({ ...l, detail: name })),
        ...recent.map((c) => ({ href: `/${slug}/calls?call=${c.id}`, label: c.title, detail: "Thread" })),
        ...workspaces.flatMap((w) => sellerOptions(w).map((o) => ({ ...o, detail: `${o.detail} in ${w.name}` }))),
      ]}
      sidebar={
        <>
          {projectId && services && teamId ? (
            <ProjectNav slug={slug} projectId={projectId} teamId={teamId} />
          ) : (
            <>
              <nav aria-label="Seller" className="grid gap-0.5">
                <Link href={`/${slug}`} aria-current={isActive(`/${slug}`) ? "page" : undefined} className={navItemClass(isActive(`/${slug}`))}>
                  <AgentIcon className="size-4" />
                  Home
                  {(prepared.data?.pending.length ?? 0) > 0 ? (
                    <span className="ml-auto text-xs font-tabular text-muted-foreground">{prepared.data?.pending.length}</span>
                  ) : null}
                </Link>
                {PLACES.map((place) => {
                  const pages = place.pages.filter((page) => allowed.has(page));
                  const only = pages[0];
                  if (only === undefined) return null;
                  if (pages.length === 1) return link(`/${slug}/${only}`, only === "settings" ? "Settings" : PAGES[only].label, place.icon);
                  const recentProjects = place.label === "Projects" ? (projectsList.data ?? []).slice(0, RECENT_PROJECTS) : [];
                  const open = pages.some((page) => isActive(`/${slug}/${page}`));
                  const Icon = place.icon;
                  return (
                    <details key={place.label} name="seller-places" open={open} className="group/place">
                      <summary className={cn(navItemClass(false), "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
                        <Icon className="size-4" aria-hidden="true" />
                        {place.label}
                        <ChevronRight className="ml-auto size-3.5 text-muted-foreground group-open/place:rotate-90" aria-hidden="true" />
                      </summary>
                      <div className="mt-0.5 mb-1 ml-[17px] grid gap-0.5 border-l pl-2.5">
                        {pages.map((page) => {
                          const href = `/${slug}/${page}`;
                          // "All projects" stays quiet on a project's own page, which has its own sidebar.
                          const current = isActive(href);
                          return (
                            <Link key={page} href={href} aria-current={current ? "page" : undefined} className={navItemClass(current)}>
                              {childLabel(page)}
                            </Link>
                          );
                        })}
                        {recentProjects.map((project) => (
                          <Link key={project.id} href={`/${slug}/projects/${project.id}`} className={cn(navItemClass(false), "grid gap-0 leading-5")}>
                            <span className="truncate">{project.title}</span>
                            <span className="truncate text-xs font-normal text-muted-foreground">{projectStatusLabel(project.status)}</span>
                          </Link>
                        ))}
                      </div>
                    </details>
                  );
                })}
              </nav>
              <RecentCalls calls={recent} callsPath={`/${slug}/calls`} label="Your threads" />
            </>
          )}
        </>
      }
      mobileNav={pageLinks.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(href) ? "page" : undefined}
          className="shrink-0 rounded-[9px] px-3 py-1.5 text-sm font-medium text-muted-foreground aria-[current=page]:raised aria-[current=page]:text-foreground"
        >
          {label}
        </Link>
      ))}
      banner={
        <>
          <BillingNotice slug={slug} />

        </>
      }
      ask={
        node && seller.data?.available && services && pathname !== `/${slug}` && !pathname.startsWith(`/${slug}/calls`) ? (
          <AskBar
            callsPath={`/${slug}/calls`}
            node={node}
            placeholder={projectId ? `Ask ${platform} about this project` : `Ask ${platform} about ${name}`}
          />
        ) : null
      }
    >
      {children}
    </AppFrame>
  );
}
