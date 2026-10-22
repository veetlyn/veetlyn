import AuthSplit from "@/components/auth/auth-split";
import AuthVisual from "@/components/auth/auth-visual";
import { consentGroups, consentHost } from "@/lib/oauth-consent";
import { platformName } from "@/lib/platform";
import { fetchOAuthClientName, requireSession } from "@/lib/server-api";

import ConsentForm from "./consent-form";

// The consent endpoint checks the signed query; this page only shows it. Anyone can register a client with any
// name, so the page leads with the host the person returns to, which the client cannot fake.
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ client_id?: string; scope?: string; redirect_uri?: string }>;
}) {
  const { user } = await requireSession();
  const { client_id: clientId = "", scope = "", redirect_uri: redirectUri = "" } = await searchParams;
  const name = platformName();
  return (
    <AuthSplit
      visual={
        <AuthVisual
          headline={
            <>
              Your AI finds the work.
              <br />
              You approve the money.
            </>
          }
          subline={`Assistants search, ask and request quotes through ${name}. Accepting and paying always take your own press.`}
        />
      }
    >
      <ConsentForm
        clientName={await fetchOAuthClientName(clientId)}
        host={consentHost(redirectUri)}
        account={{ name: user.name, email: user.email }}
        groups={consentGroups(scope.split(" ").filter(Boolean), name)}
      />
    </AuthSplit>
  );
}
