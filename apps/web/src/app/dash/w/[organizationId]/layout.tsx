import { notFound } from "next/navigation";

import WorkspaceShell from "@/components/frames/workspace-shell";
import { listMyWorkspaces, requireSession } from "@/lib/server-api";

// Every workspace page sits in the workspace's frame. Someone outside it gets the same answer as a missing one.
export default async function WorkspaceLayout({
  params,
  children,
}: {
  params: Promise<{ organizationId: string }>;
  children: React.ReactNode;
}) {
  await requireSession();
  const { organizationId } = await params;
  const organization = (await listMyWorkspaces()).find((o) => o.id === organizationId);
  if (!organization) notFound();
  return <WorkspaceShell organization={organization}>{children}</WorkspaceShell>;
}
