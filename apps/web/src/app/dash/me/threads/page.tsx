import TeamCalls from "@/app/dash/[storeSlug]/threads/team-calls";
import { platformName } from "@/lib/platform";
import { requireSession } from "@/lib/server-api";

const NODE = { kind: "account" as const };

// Calls at the account: across the person's workspaces, purchases and earnings, and every call below.
export default async function AccountCallsPage({ searchParams }: { searchParams: Promise<{ thread?: string; call?: string }> }) {
  await requireSession();
  const { thread, call } = await searchParams;
  return (
    <TeamCalls
      listNode={NODE}
      askNode={NODE}
      scopeName={"Your account"}
      callsPath="/me/threads"
      projectHref={null}
      assistantName={platformName()}
      callId={thread ?? call ?? null}
    />
  );
}
