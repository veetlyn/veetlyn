"use client";

import { useQuery } from "@tanstack/react-query";

import { mergeWorkspaces, type WorkspaceOrganization } from "@/lib/workspaces";
import { trpc } from "@/utils/trpc";

// The person's workspaces and their sellers, for the breadcrumb switchers. Empty while loading or signed out.
export function useMyWorkspaces(): WorkspaceOrganization[] {
  const stores = useQuery({ ...trpc.store.listMine.queryOptions(), retry: false, staleTime: 60_000, meta: { silent: true } });
  const teams = useQuery({
    ...trpc.servicesTeam.listMine.queryOptions(),
    retry: false,
    staleTime: 60_000,
    meta: { silent: true },
  });
  return mergeWorkspaces(stores.data ?? [], teams.data ?? []);
}

export function sellerOptions(organization: WorkspaceOrganization) {
  return [
    ...organization.servicesTeams.map((t) => ({ href: `/${t.slug}`, label: t.name, detail: "Services team" })),
    ...organization.stores.map((s) => ({ href: `/${s.slug}`, label: s.name, detail: "Store" })),
  ];
}

export function workspaceOptions(workspaces: WorkspaceOrganization[]) {
  return workspaces.map((w) => ({
    href: `/w/${w.id}`,
    label: w.name,
    detail: `${w.servicesTeams.length + w.stores.length} ${w.servicesTeams.length + w.stores.length === 1 ? "seller" : "sellers"}`,
  }));
}
