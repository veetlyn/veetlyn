const STORE_WIDE_ROLES = new Set(["owner", "admin"]);

export type StoreAccess = { role: string; isTeamMember: boolean };

// Better Auth stores several roles as one comma-separated string.
export function hasStoreWideRole(role: string): boolean {
  return role.split(",").some((r) => STORE_WIDE_ROLES.has(r.trim()));
}

// Spec §4.1: owners and admins open every store of their organization; other members only their teams' stores.
export function canOpenStore(access: StoreAccess): boolean {
  return hasStoreWideRole(access.role) || access.isTeamMember;
}
