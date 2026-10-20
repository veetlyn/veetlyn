"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import Loader from "@/components/loader";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

// The AI clients connected to Payleor's plugin (Claude, ChatGPT): each can act for the user until disconnected.
function ConnectedApps() {
  const apps = useQuery(trpc.connectedApps.list.queryOptions());
  const disconnect = useMutation(trpc.connectedApps.disconnect.mutationOptions({ onSuccess: () => apps.refetch() }));
  return (
    <section aria-labelledby="apps-heading" className="panel space-y-3 p-5">
      <h2 id="apps-heading" className="font-medium">
        Connected AI apps
      </h2>
      {apps.data?.length ? (
        <ul className="space-y-3">
          {apps.data.map((app) => (
            <li key={app.clientId} className="flex items-center justify-between gap-3">
              <span className="min-w-0 text-sm">
                <span className="block truncate font-medium">{app.name}</span>
                {app.uri ? <span className="block truncate text-muted-foreground">{app.uri}</span> : null}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate({ clientId: app.clientId })}
              >
                Disconnect
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {apps.isPending ? "Loading…" : "No AI app is connected. Connect Payleor in Claude or ChatGPT to see it here."}
        </p>
      )}
      {disconnect.error ? (
        <p role="alert" className="text-sm text-destructive">
          Could not disconnect the app. Try again.
        </p>
      ) : null}
    </section>
  );
}

export default function AccountSettings({ hasError }: { hasError: boolean }) {
  const [error, setError] = useState(hasError);
  const [pending, setPending] = useState(false);
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => (await authClient.listAccounts()).data ?? [],
  });

  async function linkDiscord() {
    setPending(true);
    setError(false);
    const result = await authClient.linkSocial({
      provider: "discord",
      callbackURL: "/account",
      errorCallbackURL: "/account?error=discord",
    });
    if (result.error) {
      setPending(false);
      setError(true);
    }
    // On success the client follows the redirect to Discord, so the button stays disabled.
  }

  if (accounts.isPending) return <Loader />;

  const discordAccount = accounts.data?.find((a) => a.providerId === "discord");

  return (
    <main className="mx-auto w-full max-w-lg space-y-6 px-4 py-6 md:px-7 md:py-8">
      <h1 className="font-heading text-3xl">Account</h1>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          Could not link Discord. Check that the email on your Discord account is verified, then try again.
        </p>
      ) : null}
      <section aria-labelledby="discord-heading" className="panel space-y-3 p-5">
        <h2 id="discord-heading" className="font-medium">
          Discord
        </h2>
        {discordAccount ? (
          <p className="text-sm text-muted-foreground">
            Discord is linked to this account. Payleor's Discord commands work for you.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Link Discord to use Payleor's commands in your team's server with this Payleor account.
            </p>
            <Button type="button" variant="outline" onClick={linkDiscord} disabled={pending}>
              {pending ? "Redirecting to Discord…" : "Link Discord"}
            </Button>
          </>
        )}
      </section>
      <ConnectedApps />
    </main>
  );
}
