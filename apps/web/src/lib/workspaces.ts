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
