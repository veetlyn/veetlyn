import TeamCalls from "@/app/dash/[storeSlug]/calls/team-calls";
import { platformName } from "@/lib/platform";
import { requireSession } from "@/lib/server-api";

// Calls at the workspace: questions about its sellers and its plan, and every call below it.
export default async function WorkspaceCallsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ call?: string }>;
}) {
  await requireSession();
  const { organizationId } = await params;
  const { call } = await searchParams;
  const node = { kind: "workspace" as const, organizationId };
  return (
    <TeamCalls listNode={node} askNode={node} callsPath={`/w/${organizationId}/calls`} projectHref={null} assistantName={platformName()} callId={call ?? null} />
  );
}
