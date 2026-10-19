import { isServicesTeamRole } from "@jendal-workspace/core";
import { Badge } from "@jendal-workspace/ui/components/badge";
import { buttonVariants } from "@jendal-workspace/ui/lib/button-variants";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getStoreUrlParts, listMyWorkspaces, requireSession } from "@/lib/server-api";
import { SERVICES_TEAM_ROLE_LABELS } from "@/lib/services-team-labels";
import { storeUrl } from "@/lib/store-url";

const STATUS_LABEL = new Map([
  ["draft", "Draft"],
  ["active", "Live"],
  ["suspended", "Suspended"],
]);

export default async function DashHome() {
  await requireSession();
  const organizations = (await listMyWorkspaces()).filter(
    (o) => o.stores.length + o.servicesTeams.length > 0,
  );
  if (organizations.length === 0) redirect("/new/services-team");
  const urlParts = await getStoreUrlParts();

  return (
    <main className="mx-auto w-full max-w-3xl space-y-8 px-4 py-6 md:px-7 md:py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-[family-name:var(--font-display)] text-3xl">Your workspace</h1>
        <span className="flex flex-wrap gap-2">
          {organizations.some((o) => o.canCreateStores) ? (
            <Link href="/new" className={buttonVariants({ variant: "outline" })}>
              Create your store
            </Link>
          ) : null}
          {/* servicesTeam.create guarantees a home organization for every signed-in user, so no gate here */}
          <Link href="/new/services-team" className={buttonVariants({ variant: "outline" })}>
            Create your services team
          </Link>
        </span>
      </div>
      {organizations.map((organization) => (
        <section key={organization.id} aria-labelledby={`org-${organization.id}`} className="space-y-3">
          <h2 id={`org-${organization.id}`} className="text-sm font-medium text-muted-foreground">
            {organization.name}
          </h2>
          <ul className="panel divide-y overflow-hidden">
            {organization.stores.map((store) => (
              <li key={store.id} className="flex items-center justify-between gap-4 px-4 py-3.5">
                <div className="min-w-0">
                  <Link href={`/${store.slug}`} className="font-medium underline-offset-4 hover:underline">
                    {store.name}
                  </Link>
                  <p className="truncate text-sm text-muted-foreground">
                    Store · {storeUrl(store.slug, urlParts)}
                  </p>
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
                <Badge>
                  {isServicesTeamRole(servicesTeam.role)
                    ? SERVICES_TEAM_ROLE_LABELS[servicesTeam.role]
                    : servicesTeam.role}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
