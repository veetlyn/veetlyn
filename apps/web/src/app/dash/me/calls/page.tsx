import TeamCalls from "@/app/dash/[storeSlug]/calls/team-calls";
import { platformName } from "@/lib/platform";
import { requireSession } from "@/lib/server-api";

const NODE = { kind: "account" as const };

// Calls at the account: across the person's workspaces, purchases and earnings, and every call below.
export default async function AccountCallsPage({ searchParams }: { searchParams: Promise<{ call?: string }> }) {
  await requireSession();
  const { call } = await searchParams;
  return (
    <TeamCalls
      listNode={NODE}
      askNode={NODE}
      scopeName={"Your account"}
      callsPath="/me/calls"
      projectHref={null}
      assistantName={platformName()}
      callId={call ?? null}
    />
  );
}
