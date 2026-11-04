"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2, HandCoins, LayoutGrid, ShoppingBag, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import AppFrame, { navItemClass, Switcher } from "@/components/app-frame";
import AskBar from "@/components/ask-bar";
import RecentCalls from "@/components/recent-calls";
import { VeetlynIcon } from "@/components/veetlyn-icon";
import { authClient } from "@/lib/auth-client";
import type { WorkspaceOrganization } from "@/lib/workspaces";
import { trpc } from "@/utils/trpc";

const NODE = { kind: "account" as const };

// The frame of the account, the top of the context tree: the person's own purchases and earnings, their workspaces,
// and Veetlyn looking across all of them.
export default function AccountShell({
  workspaces,
  children,
}: {
  workspaces: WorkspaceOrganization[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { data: session } = authClient.useSession();
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
  const name = session?.user.name ?? "Your account";
  const crumbs = [
    { href: "/", label: "Your account" },
    ...(pathname === "/me"
      ? [{ href: "/me", label: "Personal" }]
      : pathname.startsWith("/me/projects")
        ? [{ href: "/me/projects", label: "Your projects" }]
        : pathname.startsWith("/me/payouts")
          ? [{ href: "/me/payouts", label: "Your earnings" }]
          : pathname.startsWith("/me/calls")
            ? [{ href: "/me/calls", label: "Veetlyn" }]
            : []),
  ];

  return (
    <AppFrame
      crumbs={crumbs}
      sidebar={
        <>
          <Switcher
            href="/"
            initials={name.slice(0, 1)}
            name={name}
            detail="Your account"
            label={`${name}. Your account`}
          />
          <nav aria-label="Account" className="grid gap-0.5">
            {link("/me/calls", "Veetlyn", VeetlynIcon)}
            {link("/", "Overview", LayoutGrid)}
            {link("/me", "Personal", UserRound)}
            {link("/me/projects", "Your projects", ShoppingBag)}
            {link("/me/payouts", "Your earnings", HandCoins)}
          </nav>
          {workspaces.length > 0 ? (
            <div className="pt-3">
              <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">Workspaces</p>
              <nav aria-label="Workspaces" className="grid gap-0.5">
                {workspaces.map((w) => link(`/w/${w.id}`, w.name, Building2))}
              </nav>
            </div>
          ) : null}
          <RecentCalls calls={(calls.data?.calls ?? []).slice(0, 5)} callsPath="/me/calls" />
        </>
      }
      ask={
        scope.data?.available && !pathname.startsWith("/me/calls") ? (
          <AskBar callsPath="/me/calls" node={NODE} placeholder="Ask Veetlyn about everything you have" />
        ) : null
      }
    >
      {children}
    </AppFrame>
  );
}
