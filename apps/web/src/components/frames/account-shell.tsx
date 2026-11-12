"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2, HandCoins, LayoutGrid, ShoppingBag, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import AppFrame, { navItemClass } from "@/components/app-frame";
import RecentCalls from "@/components/recent-calls";
import { workspaceDestinations, type WorkspaceOrganization } from "@/lib/workspaces";
import { trpc } from "@/utils/trpc";

const NODE = { kind: "account" as const };

// The frame of the account, the top of the context tree: the person's own purchases and earnings, their workspaces,
// and the assistant looking across all of them.
export default function AccountShell({
  workspaces,
  children,
}: {
  personName: string;
  workspaces: WorkspaceOrganization[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const destinations = workspaceDestinations(workspaces);
  const scope = useQuery({ ...trpc.agent.node.queryOptions({ node: NODE }), retry: false, meta: { silent: true } });
  const calls = useQuery({
    ...trpc.agent.calls.queryOptions({ node: NODE }),
    enabled: scope.data?.available === true,
    retry: false,
    meta: { silent: true },
  });
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : href === "/me" ? pathname === "/me" : pathname.startsWith(href);
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
  const crumbs = [
    { href: "/", label: "Overview" },
    ...(pathname === "/me"
      ? [{ href: "/me", label: "Personal" }]
      : pathname.startsWith("/me/projects")
        ? [{ href: "/me/projects", label: "Your projects" }]
        : pathname.startsWith("/me/payouts")
          ? [{ href: "/me/payouts", label: "Your earnings" }]
          : pathname.startsWith("/me/threads")
            ? [{ href: "/me/threads", label: "Threads" }]
            : []),
  ];

  return (
    <AppFrame
      fill={pathname.startsWith("/me/threads")}
      workspace={{ href: "/", label: "Personal", detail: "Your account", options: [{ href: "/", label: "Personal" }, ...destinations] }}
      crumbs={crumbs}
      searchItems={[
        { href: "/", label: "Overview", detail: "Your account" },
        { href: "/me", label: "Personal", detail: "Your account" },
        { href: "/me/projects", label: "Your projects", detail: "Your account" },
        { href: "/me/payouts", label: "Your earnings", detail: "Your account" },
        { href: "/account", label: "Account settings", detail: "Your account" },
        ...destinations.map((w) => ({ ...w, group: "Workspaces" })),
      ]}
      sidebar={
        <>
          <nav aria-label="Account" className="grid gap-0.5">
            {link("/", "Overview", LayoutGrid)}
            {link("/me", "Personal", UserRound)}
            {link("/me/projects", "Your projects", ShoppingBag)}
            {link("/me/payouts", "Your earnings", HandCoins)}
          </nav>
          {workspaces.length > 0 ? (
            <div className="pt-3">
              <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">Workspaces</p>
              <nav aria-label="Workspaces" className="grid gap-0.5">
                {destinations.map((destination) => link(destination.href, destination.label, Building2))}
              </nav>
            </div>
          ) : null}
          <RecentCalls calls={(calls.data?.calls ?? []).slice(0, 5)} callsPath="/me/threads" label="Your threads" />
        </>
      }
    >
      {children}
    </AppFrame>
  );
}
