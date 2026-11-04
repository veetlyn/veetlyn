import AccountShell from "@/components/frames/account-shell";
import { listMyWorkspaces, requireSession } from "@/lib/server-api";

// The person's own pages sit in the account's frame.
export default async function PersonalLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const workspaces = await listMyWorkspaces();
  return <AccountShell personName={session.user.name} workspaces={workspaces}>{children}</AccountShell>;
}
