import AuthCard from "@/components/auth/auth-card";
import { requireSession } from "@/lib/server-api";

import ConsentForm from "./consent-form";

// The consent endpoint checks the signed query; this page only shows it. Anyone can register a client with any
// name, so the page names the host the person returns to, which the client cannot fake.
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ client_id?: string; scope?: string; redirect_uri?: string }>;
}) {
  await requireSession();
  const { client_id: clientId = "", scope = "", redirect_uri: redirectUri = "" } = await searchParams;
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-10 md:py-16">
      <AuthCard title="Connect your AI assistant">
        <ConsentForm clientId={clientId} scopes={scope.split(" ").filter(Boolean)} redirectUri={redirectUri} />
      </AuthCard>
    </main>
  );
}
