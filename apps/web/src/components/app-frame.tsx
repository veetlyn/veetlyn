"use client";

import { cn } from "@jendal-workspace/ui/lib/utils";
import Link from "next/link";

import { BrandWordmark } from "@/components/brand-mark";
import { ModeToggle } from "@/components/mode-toggle";
import UserMenu from "@/components/user-menu";

export type Crumb = { href: string; label: string };

// The dash frame at every level of the context tree (calls design §6): the node's sidebar on the tray, the page on a
// framed canvas with where you are on top, and the assistant at the foot. Only the canvas scrolls.
export default function AppFrame({
  sidebar,
  mobileNav,
  crumbs,
  ask,
  banner,
  collapsed = false,
  children,
}: {
  sidebar: React.ReactNode;
  mobileNav?: React.ReactNode;
  crumbs: Crumb[];
  ask?: React.ReactNode;
  banner?: React.ReactNode;
  // In a call the sidebar folds away and the conversation and its subject take the width.
  collapsed?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      data-app-shell
      className={cn(
        "grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] bg-tray",
        !collapsed && "md:grid-cols-[256px_minmax(0,1fr)]",
      )}
    >
      <aside
        className={cn("hidden min-h-0 flex-col gap-0.5 overflow-y-auto px-2.5 pt-2.5 pb-3", !collapsed && "md:flex")}
      >
        {sidebar}
        <div className="mt-auto pt-4">
          <Link href="/" className="flex items-center gap-2 px-2.5 text-sm text-muted-foreground hover:text-foreground">
            <BrandWordmark className="font-heading text-[15px] text-foreground" />
            <span className="sr-only">Your account</span>
          </Link>
        </div>
      </aside>

      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-col bg-card md:my-2 md:mr-2 md:frame md:rounded-[14px] md:shadow-[0_1px_2px_rgb(16_16_24/0.05)]",
          collapsed && "md:ml-2",
        )}
      >
        <div className="flex h-[52px] shrink-0 items-center gap-2 border-b px-4 md:px-6">
          <Link href="/" className="md:hidden">
            <BrandWordmark className="font-heading text-[15px]" />
            <span className="sr-only">Your account</span>
          </Link>
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            {crumbs.map((crumb, i) => (
              <span
                key={crumb.href}
                className={cn("min-w-0 items-center gap-1.5", i === crumbs.length - 1 ? "flex" : "hidden md:flex")}
              >
                {i > 0 ? <span className="hidden text-border md:inline">/</span> : null}
                {i === crumbs.length - 1 ? (
                  <span className="truncate font-medium text-foreground">{crumb.label}</span>
                ) : (
                  <Link href={crumb.href} className="truncate hover:text-foreground">
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
        {mobileNav ? (
          <nav
            aria-label="Sections"
            className="flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-2 [scrollbar-width:none] md:hidden"
          >
            {mobileNav}
          </nav>
        ) : null}
        <div
          id="page-scroll"
          className={cn(
            "min-h-0 flex-1 motion-safe:scroll-smooth",
            // A call holds its own scrolling panes: the banners sit above it and it takes the height left.
            collapsed ? "flex flex-col overflow-hidden" : "overflow-y-auto",
          )}
        >
          {banner}
          {children}
        </div>
        {ask}
      </div>
    </div>
  );
}

// A sidebar item, raised when it is the page you are on.
export function navItemClass(active: boolean) {
  return cn(
    "flex items-center gap-2.5 rounded-[9px] px-2.5 py-[7px] text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
    active ? "raised text-foreground" : "hover:bg-foreground/[0.04]",
  );
}

// The node's switcher at the top of the sidebar: its mark, name and the person's role there.
export function Switcher({
  href,
  initials,
  name,
  detail,
  label,
}: {
  href: string;
  initials: string;
  name: string;
  detail: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="mb-2 flex items-center gap-2.5 rounded-[11px] px-2 py-1.5 raised transition-[filter] hover:brightness-[0.98]"
      aria-label={label}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-[8px] main-surface text-xs font-semibold uppercase">
        {initials}
      </span>
      <span className="grid min-w-0 flex-1">
        <b className="truncate text-sm font-semibold">{name}</b>
        <span className="truncate text-xs text-muted-foreground">{detail}</span>
      </span>
      <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-muted-foreground" aria-hidden="true">
        <path
          d="m5 6 3-3 3 3M5 10l3 3 3-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  );
}

export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((word) => word[0] ?? "")
      .join("")
      .slice(0, 2) || "?"
  );
}
