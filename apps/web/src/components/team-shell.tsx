"use client";

import { cn } from "@jendal-workspace/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpFromLine,
  FolderKanban,
  HandCoins,
  Inbox,
  LayoutGrid,
  MessagesSquare,
  Package,
  ScrollText,
  Settings,
  Tag,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { BrandMark } from "@/components/brand-mark";
import { ModeToggle } from "@/components/mode-toggle";
import { PlatformName } from "@/components/platform-name";
import UserMenu from "@/components/user-menu";
import { SERVICES_TEAM_ROLE_LABELS } from "@/lib/services-team-labels";
import { trpc } from "@/utils/trpc";

type NavItem = { href: string; label: string; icon: typeof Inbox; show?: boolean };

const SEGMENT_LABELS = new Map<string, string>([
  ["projects", "Projects"],
  ["requests", "Open requests"],
  ["services", "Services"],
  ["products", "Products"],
  ["orders", "Orders"],
  ["settings", "Settings"],
  ["members", "Members"],
  ["payouts", "Payouts"],
  ["rules", "Rules"],
  ["discord", "Discord"],
  ["preview", "Preview"],
  ["new", "New"],
]);

// The frame around every team page: the sections on the left, where you are and your account on top.
export default function TeamShell({
  slug,
  kind,
  children,
}: {
  slug: string;
  kind: "services" | "store";
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const team = useQuery({
    ...trpc.servicesTeam.get.queryOptions({ teamSlug: slug }),
    enabled: kind === "services",
    retry: false,
    meta: { silent: true },
  });
  const rules = useQuery({
    ...trpc.rules.state.queryOptions({ teamSlug: slug }),
    enabled: kind === "services" && team.isSuccess,
    retry: false,
    meta: { silent: true },
  });

  const data = team.data;
  const solo = data?.settings?.solo ?? false;
  const storeEnabled = kind === "store" || (data?.settings?.storeEnabled ?? false);
  const admin = kind === "store" || data?.role === "admin";
  const name = data?.team.name ?? slug.replace(/-/g, " ");
  const initials = name.split(/\s+/).map((word) => word[0] ?? "").join("").slice(0, 2) || "?";
  const roleLabel = kind === "store" ? "Store" : data ? (SERVICES_TEAM_ROLE_LABELS[data.role] ?? data.role) : "";

  const work: NavItem[] = [
    { href: `/${slug}`, label: "Overview", icon: LayoutGrid },
    { href: `/${slug}/requests`, label: "Open requests", icon: HandCoins, show: kind === "services" && !solo },
    { href: `/${slug}/projects`, label: "Projects", icon: FolderKanban, show: kind === "services" },
    { href: `/${slug}/services`, label: "Services", icon: Tag, show: kind === "services" },
    { href: `/${slug}/products`, label: "Products", icon: Package, show: storeEnabled },
    { href: `/${slug}/orders`, label: "Orders", icon: Inbox, show: kind === "services" && storeEnabled && admin },
  ];
  const team_: NavItem[] = [
    { href: `/${slug}/payouts`, label: "Payouts", icon: ArrowUpFromLine, show: kind === "services" && !solo },
    { href: `/${slug}/members`, label: "Members", icon: Users, show: kind === "services" && !solo },
    { href: `/${slug}/rules`, label: "Rules", icon: ScrollText, show: kind === "services" },
    { href: `/${slug}/discord`, label: "Discord", icon: MessagesSquare, show: kind === "services" && admin },
    { href: `/${slug}/settings`, label: "Settings", icon: Settings, show: kind === "services" },
  ];

  const segments = pathname.split("/").filter(Boolean).slice(1);
  const crumbs = [{ href: `/${slug}`, label: name }].concat(
    segments.map((segment, i) => ({
      href: `/${slug}/${segments.slice(0, i + 1).join("/")}`,
      label: SEGMENT_LABELS.get(segment) ?? (i > 0 && segments[i - 1] === "projects" ? "Project" : "Details"),
    })),
  );

  const isActive = (href: string) =>
    href === `/${slug}` ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  const navList = (items: NavItem[]) =>
    items
      .filter((item) => item.show !== false)
      .map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          aria-current={isActive(href) ? "page" : undefined}
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            "aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-[0_0_0_1px_var(--input)]",
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </Link>
      ));

  return (
    // The window stays still: the sidebar and the top bar hold their place and only the page content scrolls.
    <div data-app-shell className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] md:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="hidden min-h-0 flex-col gap-1 overflow-y-auto border-r bg-sidebar px-3 py-4 md:flex">
        <Link href="/" className="mb-3 flex items-center gap-2 px-1.5 text-sm text-muted-foreground hover:text-foreground">
          <BrandMark className="size-5 text-foreground" />
          <span className="font-heading text-base text-foreground">
            <PlatformName />
          </span>
          <span className="sr-only">All workspaces</span>
        </Link>
        <div className="mb-3 flex items-center gap-2.5 rounded-xl px-2 py-2 raised">
          <span className="grid size-8 place-items-center rounded-lg main-surface text-xs font-semibold uppercase">
            {initials}
          </span>
          <span className="grid min-w-0">
            <b className="truncate text-sm font-semibold capitalize">{name}</b>
            <span className="truncate text-xs text-muted-foreground">{roleLabel}</span>
          </span>
        </div>
        <nav aria-label="Work" className="grid gap-0.5">
          {navList(work)}
        </nav>
        {team_.some((item) => item.show !== false) ? (
          <>
            <p className="px-2.5 pt-4 pb-1.5 text-xs font-medium text-muted-foreground">Team</p>
            <nav aria-label="Team" className="grid gap-0.5">
              {navList(team_)}
            </nav>
          </>
        ) : null}
      </aside>
      <div className="flex min-h-0 min-w-0 flex-col">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4 md:px-7">
          <Link href="/" className="md:hidden">
            <BrandMark className="size-6 text-foreground" />
            <span className="sr-only">All workspaces</span>
          </Link>
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            {crumbs.map((crumb, i) => (
              <span key={crumb.href} className={cn("min-w-0 items-center gap-1.5", i === crumbs.length - 1 ? "flex" : "hidden md:flex")}>
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
        <nav aria-label="Sections" className="flex shrink-0 gap-1 overflow-x-auto [scrollbar-width:none] border-b px-3 py-2 md:hidden">
          {[...work, ...team_]
            .filter((item) => item.show !== false)
            .map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                aria-current={isActive(href) ? "page" : undefined}
                className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground aria-[current=page]:bg-card aria-[current=page]:text-foreground aria-[current=page]:shadow-[0_0_0_1px_var(--input)]"
              >
                {label}
              </Link>
            ))}
        </nav>
        <div id="page-scroll" className="min-h-0 flex-1 overflow-y-auto motion-safe:scroll-smooth">
        {rules.data?.memberAccepted === false && pathname !== `/${slug}/rules` ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-tray px-4 py-2.5 md:px-7" role="status">
            <p className="text-sm">Accept version {rules.data.published.version} of the member agreement before taking new work.</p>
            <Link href={`/${slug}/rules#published-rules`} className="text-sm font-semibold underline underline-offset-4">Review team rules</Link>
          </div>
        ) : null}
        {children}
        </div>
      </div>
    </div>
  );
}
