"use client";

import { useQuery } from "@tanstack/react-query";
import { CreditCard, LayoutGrid, Store, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import AppFrame, { navItemClass } from "@/components/app-frame";
import RecentCalls from "@/components/recent-calls";
import type { WorkspaceOrganization } from "@/lib/workspaces";
import { useMyWorkspaces, workspaceOptions } from "@/hooks/use-my-workspaces";
import { trpc } from "@/utils/trpc";

const ROLE_LABELS = new Map([
  ["owner", "Owner"],
  ["admin", "Admin"],
  ["member", "Member"],
]);

export function workspaceRoleLabel(role: string): string {
  return role
    .split(",")
    .map((r) => ROLE_LABELS.get(r.trim()) ?? r.trim())
    .join(", ");
}

// The frame of a workspace (context graph inventory §1): its sellers and billing on the tray, the assistant at the
// workspace node. Opening a seller moves down the tree to that seller's own frame.
export default function WorkspaceShell({
  organization,
  children,
}: {
  organization: WorkspaceOrganization;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const base = `/w/${organization.id}`;
  const node = { kind: "workspace" as const, organizationId: organization.id };
  const scope = useQuery({ ...trpc.agent.node.queryOptions({ node }), retry: false, meta: { silent: true } });
  const calls = useQuery({
    ...trpc.agent.calls.queryOptions({ node }),
    enabled: scope.data?.available === true,
    retry: false,
    meta: { silent: true },
  });
  const isActive = (href: string) => (href === base ? pathname === href : pathname.startsWith(href));
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
  const sellers = [
    ...organization.servicesTeams.map((t) => ({ slug: t.slug, name: t.name, icon: Users })),
    ...organization.stores.map((s) => ({ slug: s.slug, name: s.name, icon: Store })),
  ];
  const segment = pathname.slice(base.length).split("/").filter(Boolean)[0];
  const workspaces = useMyWorkspaces();
  // Workspace › section. The workspace crumb switches; the sidebar already lists this workspace's sellers.
  const crumbs = [
    { href: base, label: organization.name, options: workspaceOptions(workspaces), menuLabel: "Workspaces" },
    ...(segment === "billing"
      ? [{ href: `${base}/billing`, label: "Billing" }]
      : segment === "calls"
        ? [{ href: `${base}/calls`, label: "Threads" }]
        : []),
  ];

  return (
    <AppFrame
      fill={segment === "calls"}
      crumbs={crumbs}
      searchItems={[
        { href: base, label: "Overview", detail: organization.name },
        ...(organization.canCreateStores ? [{ href: `${base}/billing`, label: "Billing", detail: organization.name }] : []),
        ...sellers.map((s) => ({ href: `/${s.slug}`, label: s.name, detail: `Seller in ${organization.name}` })),
        ...workspaceOptions(workspaces),
      ]}
      sidebar={
        <>
          <nav aria-label="Workspace" className="grid gap-0.5">
            {link(base, "Overview", LayoutGrid)}
            {organization.canCreateStores ? link(`${base}/billing`, "Billing", CreditCard) : null}
          </nav>
          {sellers.length > 0 ? (
            <div className="pt-3">
              <p className="px-2.5 pb-1 text-xs font-medium text-muted-foreground">Sellers</p>
              <nav aria-label="Sellers" className="grid gap-0.5">
                {sellers.map((s) => link(`/${s.slug}`, s.name, s.icon))}
              </nav>
            </div>
          ) : null}
          <RecentCalls calls={(calls.data?.calls ?? []).slice(0, 5)} callsPath={`${base}/calls`} label="Your threads" />
        </>
      }
    >
      {children}
    </AppFrame>
  );
}
