import AuthCard from "@/components/auth/auth-card";
import { requireSession } from "@/lib/server-api";

import ConsentForm from "./consent-form";

// The consent endpoint verifies the signed query; this page only displays it.
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ client_id?: string; scope?: string }>;
}) {
  await requireSession();
  const { client_id: clientId = "", scope = "" } = await searchParams;
  return (
    <AuthCard title="Allow access">
      <ConsentForm clientId={clientId} scopes={scope.split(" ").filter(Boolean)} />
    </AuthCard>
  );
}
