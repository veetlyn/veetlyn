import AccountShell from "@/components/frames/account-shell";
import { listMyWorkspaces, requireSession } from "@/lib/server-api";

import AccountSettings from "./account-settings";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [session, workspaces, { error }] = await Promise.all([requireSession(), listMyWorkspaces(), searchParams]);
  const organizations = workspaces.filter((o) => o.stores.length + o.servicesTeams.length > 0);
  return (
    <AccountShell personName={session.user.name} workspaces={organizations}>
      <AccountSettings hasError={Boolean(error)} />
    </AccountShell>
  );
}
