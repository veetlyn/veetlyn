import AuthSplit from "@/components/auth/auth-split";
import AuthVisual from "@/components/auth/auth-visual";
import { consentGroups, consentHost } from "@/lib/oauth-consent";
import { platformName } from "@/lib/platform";
import { fetchConsentView, fetchOAuthClientName, requireSession } from "@/lib/server-api";

import ConsentForm from "./consent-form";

// The consent endpoint checks the signed query; this page only shows it. Anyone can register a client with any
// name, so the page leads with the host the person returns to, which the client cannot fake.
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await requireSession();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  // Only what the signed authorization query proves is shown; a changed or expired link gets no Allow button.
  const view = await fetchConsentView(query.toString());
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
      {view ? (
        <ConsentForm
          clientName={await fetchOAuthClientName(view.clientId)}
          host={consentHost(view.redirectUri)}
          account={{ name: user.name, email: user.email }}
          groups={consentGroups(view.scopes, name)}
        />
      ) : (
        <div className="space-y-3">
          <h1 className="font-heading text-3xl">This connection link can&apos;t be used</h1>
          <p className="text-sm text-muted-foreground">
            It has expired or was changed after {name} created it. Start connecting again from your AI assistant.
          </p>
        </div>
      )}
    </AuthSplit>
  );
}
