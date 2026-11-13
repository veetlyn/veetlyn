// The two lists a workspace page needs; both are teams (services spec §3) with different products.
export interface WorkspaceStore {
  id: string;
  slug: string;
  name: string;
  status: string;
}

export interface WorkspaceServicesTeam {
  id: string;
  slug: string;
  name: string;
  role: string;
}

export interface WorkspaceOrganization {
  id: string;
  name: string;
  role: string;
  canCreateStores: boolean;
  stores: WorkspaceStore[];
  servicesTeams: WorkspaceServicesTeam[];
}

type StoreSide = Pick<WorkspaceOrganization, "id" | "name" | "role" | "canCreateStores" | "stores">;
type ServicesSide = Pick<WorkspaceOrganization, "id" | "name" | "role" | "servicesTeams">;

// The workspace home merges the store list and the services team list, one section per organization.
export function mergeWorkspaces(storeSide: StoreSide[], servicesSide: ServicesSide[]): WorkspaceOrganization[] {
  const merged = new Map<string, WorkspaceOrganization>();
  for (const org of storeSide) {
    merged.set(org.id, { ...org, servicesTeams: [] });
  }
  for (const org of servicesSide) {
    const existing = merged.get(org.id);
    if (existing) {
      existing.servicesTeams = org.servicesTeams;
    } else {
      merged.set(org.id, { ...org, canCreateStores: false, stores: [] });
    }
  }
  return [...merged.values()];
}

// One navigation entry per workspace. A workspace is a Better Auth organization: it owns members and billing, and
// holds the stores and services teams (Better Auth teams). With exactly one team the entry opens that team's modules
// directly, so the common case has no extra step; otherwise it opens the workspace overview.
export function workspaceDestination(organization: WorkspaceOrganization) {
  const teams = [
    ...organization.servicesTeams.map((team) => ({ slug: team.slug, label: `${team.name} · Services team` })),
    ...organization.stores.map((store) => ({ slug: store.slug, label: `${store.name} · Store` })),
  ];
  const only = teams.length === 1 ? teams[0] : undefined;
  return {
    href: only ? `/${only.slug}` : `/w/${organization.id}`,
    label: organization.name,
    detail: only ? only.label : teams.length === 0 ? "Set up workspace" : `${teams.length} teams`,
    organizationId: organization.id,
  };
}

export function workspaceDestinations(workspaces: readonly WorkspaceOrganization[]) {
  return workspaces.map(workspaceDestination);
}
