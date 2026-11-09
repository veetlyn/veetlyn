"use client";

import type { ContextNode, SectionPage } from "@jendal-workspace/core/context/node";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  FolderKanban,
  HandCoins,
  Inbox,
  LayoutGrid,
  type LucideIcon,
  Package,
  Settings,
  ShieldAlert,
  Store,
  Tag,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import AppFrame, { navItemClass } from "@/components/app-frame";
import AskBar from "@/components/ask-bar";
import RecentCalls from "@/components/recent-calls";
import BillingNotice from "@/components/billing-notice";
import ProjectNav from "@/components/project-nav";
import { usePlatformName } from "@/components/platform-name";
import { sellerOptions, useMyWorkspaces, workspaceOptions } from "@/hooks/use-my-workspaces";
import { trpc } from "@/utils/trpc";

const PAGES = {
  requests: { label: "Open requests", icon: HandCoins },
  projects: { label: "Projects", icon: FolderKanban },
  payments: { label: "Payments", icon: ArrowDownToLine },
  payouts: { label: "Payouts", icon: ArrowUpFromLine },
  cases: { label: "PayPal cases", icon: ShieldAlert },
  services: { label: "Services", icon: Tag },
  products: { label: "Products", icon: Package },
  orders: { label: "Orders", icon: Inbox },
  preview: { label: "Seller page", icon: Store },
  members: { label: "Members", icon: Users },
  settings: { label: "Settings", icon: Settings },
} satisfies Record<SectionPage, { label: string; icon: LucideIcon }>;

const SECTION_LABELS = {
  requests: "Requests",
  projects: "Projects",
  money: "Money",
  storefront: "Storefront",
  team: "Team",
  settings: "",
};

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
  // A section with one page needs no heading over it: its page joins the top group. Settings stays at the foot.
  const single = sections.filter((s) => s.pages.length === 1 && s.section !== "settings").flatMap((s) => s.pages);
  const grouped = sections.filter((s) => s.pages.length > 1 || s.section === "settings");

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
    { href: `/${slug}`, label: "Overview" },
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
                {link(`/${slug}`, "Overview", LayoutGrid)}
                {single.map((page) => link(`/${slug}/${page}`, PAGES[page].label, PAGES[page].icon))}
              </nav>
              {grouped.map(({ section, pages }) => (
                <div key={section} className="pt-3">
                  {SECTION_LABELS[section] ? (
                    <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">{SECTION_LABELS[section]}</p>
                  ) : null}
                  <nav aria-label={SECTION_LABELS[section] || "Settings"} className="grid gap-0.5">
                    {pages.map((page) => link(`/${slug}/${page}`, PAGES[page].label, PAGES[page].icon))}
                  </nav>
                </div>
              ))}
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
