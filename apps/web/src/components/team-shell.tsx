"use client";

import type { ContextNode, SectionPage } from "@jendal-workspace/core/context/node";
import { cn } from "@jendal-workspace/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronsUpDown,
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

import AskBar from "@/components/ask-bar";
import BillingNotice from "@/components/billing-notice";
import { BrandWordmark } from "@/components/brand-mark";
import { ModeToggle } from "@/components/mode-toggle";
import ProjectNav from "@/components/project-nav";
import UserMenu from "@/components/user-menu";
import { SERVICES_TEAM_ROLE_LABELS } from "@/lib/services-team-labels";
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
  ["calls", "Veetlyn"],
  ["rules", "Rules"],
  ["operating-model", "Operating model"],
  ["channels", "Channels"],
  ["new", "New"],
]);

function navItem(active: boolean) {
  return cn(
    "flex items-center gap-2.5 rounded-[9px] px-2.5 py-[7px] text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
    active ? "raised text-foreground" : "hover:bg-foreground/[0.04]",
  );
}

// The frame around every seller page (calls design §6): the seller's sections on the tray, the page on a framed canvas,
// and Veetlyn at the foot of every page. What the sidebar lists comes from the seller's node: its product, the
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
  const rules = useQuery({
    ...trpc.rules.state.queryOptions({ teamSlug: slug }),
    enabled: services,
    retry: false,
    meta: { silent: true },
  });
  const teamId = scope?.seller?.id ?? "";
  const calls = useQuery({
    ...trpc.agent.calls.queryOptions({ node: { kind: "seller", teamId } }),
    enabled: teamId !== "" && seller.data?.available === true,
    retry: false,
    meta: { silent: true },
  });

  const name = scope?.seller?.name ?? slug.replace(/-/g, " ");
  const initials =
    name
      .split(/\s+/)
      .map((word) => word[0] ?? "")
      .join("")
      .slice(0, 2) || "?";
  const role = scope?.seller?.role;
  const roleLabel = !role
    ? ""
    : role.product === "store"
      ? role.role === "admin"
        ? "Store admin"
        : "Store staff"
      : (SERVICES_TEAM_ROLE_LABELS[role.role] ?? role.role);
  const sections = (scope?.seller?.sections ?? [])
    .map((s) => ({ ...s, pages: services ? s.pages : s.pages.filter((p) => STORE_PAGES.has(p)) }))
    .filter((s) => s.pages.length > 0);
  // A section with one page needs no heading over it: its page joins the top group. Settings stays at the foot.
  const single = sections.filter((s) => s.pages.length === 1 && s.section !== "settings").flatMap((s) => s.pages);
  const grouped = sections.filter((s) => s.pages.length > 1 || s.section === "settings");

  const segments = pathname.split("/").filter(Boolean).slice(1);
  const projectId = segments[0] === "projects" && segments[1] && segments[1] !== "new" ? segments[1] : null;
  // Where Veetlyn starts from on this page: the project open here, or the whole seller.
  const node: ContextNode | null = !teamId
    ? null
    : projectId && services
      ? { kind: "record", teamId, record: { type: "project", id: projectId } }
      : { kind: "seller", teamId };

  const crumbs = [{ href: `/${slug}`, label: name }].concat(
    segments.map((segment, i) => ({
      href: `/${slug}/${segments.slice(0, i + 1).join("/")}`,
      label: SEGMENT_LABELS.get(segment) ?? (i > 0 && segments[i - 1] === "projects" ? "Project" : "Details"),
    })),
  );
  const isActive = (href: string) =>
    href === `/${slug}` ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  const link = (href: string, label: string, Icon: React.ComponentType<{ className?: string }>) => (
    <Link key={href} href={href} aria-current={isActive(href) ? "page" : undefined} className={navItem(isActive(href))}>
      <Icon className="size-4" aria-hidden="true" />
      {label}
    </Link>
  );
  const recent = (calls.data?.calls ?? []).slice(0, 5);

  return (
    // The window stays still: the tray and the canvas hold their place and only the page scrolls.
    <div
      data-app-shell
      className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] bg-tray md:grid-cols-[256px_minmax(0,1fr)]"
    >
      <aside className="hidden min-h-0 flex-col gap-0.5 overflow-y-auto px-2.5 pt-2.5 pb-3 md:flex">
        <Link
          href="/"
          className="mb-2 flex items-center gap-2.5 rounded-[11px] px-2 py-1.5 raised transition-[filter] hover:brightness-[0.98]"
          aria-label={`${name}, ${roleLabel}. All workspaces`}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-[8px] main-surface text-xs font-semibold uppercase">
            {initials}
          </span>
          <span className="grid min-w-0 flex-1">
            <b className="truncate text-sm font-semibold capitalize">{name}</b>
            <span className="truncate text-xs text-muted-foreground">{roleLabel}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
        {projectId && services && teamId ? (
          <ProjectNav slug={slug} projectId={projectId} teamId={teamId} />
        ) : (
          <>
            <nav aria-label="Seller" className="grid gap-0.5">
              {services ? link(`/${slug}/calls`, "Veetlyn", VeetlynIcon) : null}
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
            {recent.length > 0 ? (
              <div className="pt-4">
                <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">Calls</p>
                <ul className="grid gap-0.5">
                  {recent.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/${slug}/calls?call=${c.id}`}
                        className="block truncate rounded-[9px] px-2.5 py-1.5 text-[13px] text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground"
                      >
                        {c.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
        <div className="mt-auto pt-4">
          <Link href="/" className="flex items-center gap-2 px-2.5 text-sm text-muted-foreground hover:text-foreground">
            <BrandWordmark className="font-heading text-[15px] text-foreground" />
            <span className="sr-only">All workspaces</span>
          </Link>
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-col bg-card md:my-2 md:mr-2 md:frame md:rounded-[14px] md:shadow-[0_1px_2px_rgb(16_16_24/0.05)]">
        <div className="flex h-[52px] shrink-0 items-center gap-2 border-b px-4 md:px-6">
          <Link href="/" className="font-heading text-[15px] md:hidden">
            {initials}
            <span className="sr-only">All workspaces</span>
          </Link>
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            {crumbs.map((crumb, i) => (
              <span
                key={crumb.href}
                className={cn("min-w-0 items-center gap-1.5", i === crumbs.length - 1 ? "flex" : "hidden md:flex")}
              >
                {i > 0 ? <span className="hidden text-border md:inline">/</span> : null}
                {i === crumbs.length - 1 ? (
                  <span className="truncate font-medium text-foreground capitalize">{crumb.label}</span>
                ) : (
                  <Link href={crumb.href} className="truncate capitalize hover:text-foreground">
                    {crumb.label}
                  </Link>
                )}
              </span>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ModeToggle />
            <UserMenu />
          </div>
        </div>
        <nav
          aria-label="Sections"
          className="flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-2 [scrollbar-width:none] md:hidden"
        >
          {[
            ...(services ? [{ href: `/${slug}/calls`, label: "Veetlyn" }] : []),
            { href: `/${slug}`, label: "Overview" },
          ]
            .concat(sections.flatMap((s) => s.pages.map((p) => ({ href: `/${slug}/${p}`, label: PAGES[p].label }))))
            .map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(href) ? "page" : undefined}
                className="shrink-0 rounded-[9px] px-3 py-1.5 text-sm font-medium text-muted-foreground aria-[current=page]:raised aria-[current=page]:text-foreground"
              >
                {label}
              </Link>
            ))}
        </nav>
        <div id="page-scroll" className="min-h-0 flex-1 overflow-y-auto motion-safe:scroll-smooth">
          <BillingNotice slug={slug} />
          {rules.data?.memberAccepted === false && pathname !== `/${slug}/settings/operating-model` ? (
            <div
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-tray px-4 py-2.5 md:px-7"
              role="status"
            >
              <p className="text-sm">
                Accept version {rules.data.published.version} of the member agreement before taking new work.
              </p>
              <Link
                href={`/${slug}/settings/operating-model#published-rules`}
                className="text-sm font-semibold underline underline-offset-4"
              >
                Review team rules
              </Link>
            </div>
          ) : null}
          {children}
        </div>
        {node && seller.data?.available && services && !pathname.startsWith(`/${slug}/calls`) ? (
          <AskBar
            slug={slug}
            node={node}
            placeholder={projectId ? "Ask Veetlyn about this project" : `Ask Veetlyn about ${name}`}
          />
        ) : null}
      </div>
    </div>
  );
}

// Veetlyn's own item: the four-point spark the site uses for the agent.
function VeetlynIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path d="M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8 6.6 6.6Z" fill="currentColor" />
    </svg>
  );
}
