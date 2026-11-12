import { buttonVariants } from "@jendal-workspace/ui/lib/button-variants";
import Link from "next/link";
import { redirect } from "next/navigation";

import AccountShell from "@/components/frames/account-shell";
import { listMyWorkspaces, requireSession } from "@/lib/server-api";
import { workspaceDestinations } from "@/lib/workspaces";

// The account: the person's own purchases and earnings first, then each workspace they belong to. A workspace's
// sellers sit one level down, so the account level exists even for someone with one workspace.
export default async function AccountHome() {
  const session = await requireSession();
  const workspaces = await listMyWorkspaces();
  const organizations = workspaces.filter((o) => o.stores.length + o.servicesTeams.length > 0);
  if (organizations.length === 0) redirect("/new/services-team");

  return (
    <AccountShell personName={session.user.name} workspaces={organizations}>
      <main className="mx-auto w-full max-w-3xl space-y-8 px-4 py-6 md:px-7 md:py-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="font-heading text-3xl">Personal</h1>
          <span className="flex flex-wrap gap-2">
            {/* Each creates a new workspace with its own trial and plan; adding to a workspace starts from its page. */}
            <Link href="/new" className={buttonVariants({ variant: "outline" })}>
              New store
            </Link>
            <Link href="/new/services-team" className={buttonVariants({ variant: "outline" })}>
              New services team
            </Link>
          </span>
        </div>
        <ul className="panel divide-y overflow-hidden">
          <li>
            <Link href="/me" className="grid gap-0.5 px-4 py-3.5 transition-colors hover:bg-accent/60">
              <span className="font-medium">Personal</span>
              <span className="text-sm text-muted-foreground">What you buy from sellers, and what teams owe you</span>
            </Link>
          </li>
          {workspaceDestinations(organizations).map((workspace) => {
            return (
              <li key={workspace.href}>
                <Link
                  href={workspace.href}
                  className="grid gap-0.5 px-4 py-3.5 transition-colors hover:bg-accent/60"
                >
                  <span className="font-medium">{workspace.label}</span>
                  <span className="text-sm text-muted-foreground">Workspace · {workspace.detail}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </main>
    </AccountShell>
  );
}
