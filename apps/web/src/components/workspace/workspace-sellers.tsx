import { isServicesTeamRole } from "@jendal-workspace/core";
import { Badge } from "@jendal-workspace/ui/components/badge";
import Link from "next/link";

import { SERVICES_TEAM_ROLE_LABELS } from "@/lib/services-team-labels";
import { storeUrl, type StoreUrlParts } from "@/lib/store-url";
import type { WorkspaceOrganization } from "@/lib/workspaces";

const STATUS_LABEL = new Map([
  ["draft", "Draft"],
  ["active", "Live"],
  ["suspended", "Suspended"],
]);

// A workspace's sellers: its stores with their status, its services teams with the viewer's role.
export function WorkspaceSellers({ organization, urlParts }: { organization: WorkspaceOrganization; urlParts: StoreUrlParts }) {
  return (
    <ul className="panel divide-y overflow-hidden">
      {organization.stores.map((store) => (
        <li key={store.id} className="flex items-center justify-between gap-4 px-4 py-3.5">
          <div className="min-w-0">
            <Link href={`/${store.slug}`} className="font-medium underline-offset-4 hover:underline">
              {store.name}
            </Link>
            <p className="truncate text-sm text-muted-foreground">Store — {storeUrl(store.slug, urlParts)}</p>
          </div>
          <Badge tone={store.status === "active" ? "good" : store.status === "suspended" ? "warn" : "neutral"}>
            {STATUS_LABEL.get(store.status) ?? store.status}
          </Badge>
        </li>
      ))}
      {organization.servicesTeams.map((servicesTeam) => (
        <li key={servicesTeam.id} className="flex items-center justify-between gap-4 px-4 py-3.5">
          <div className="min-w-0">
            <Link href={`/${servicesTeam.slug}`} className="font-medium underline-offset-4 hover:underline">
              {servicesTeam.name}
            </Link>
            <p className="truncate text-sm text-muted-foreground">Services team</p>
          </div>
          <Badge>{isServicesTeamRole(servicesTeam.role) ? SERVICES_TEAM_ROLE_LABELS[servicesTeam.role] : servicesTeam.role}</Badge>
        </li>
      ))}
    </ul>
  );
}
