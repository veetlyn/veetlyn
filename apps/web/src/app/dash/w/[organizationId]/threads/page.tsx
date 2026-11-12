import TeamCalls from "@/app/dash/[storeSlug]/threads/team-calls";
import { platformName } from "@/lib/platform";
import { requireSession } from "@/lib/server-api";

// Calls at the workspace: questions about its sellers and its plan, and every call below it.
export default async function WorkspaceCallsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ thread?: string; call?: string }>;
}) {
  await requireSession();
  const { organizationId } = await params;
  const { thread, call } = await searchParams;
  const node = { kind: "workspace" as const, organizationId };
  return (
    <TeamCalls
      listNode={node}
      askNode={node}
      scopeName={"Workspace"}
      callsPath={`/w/${organizationId}/threads`}
      projectHref={null}
      assistantName={platformName()}
      callId={thread ?? call ?? null}
    />
  );
}
