"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import Loader from "@/components/loader";
import { authClient } from "@/lib/auth-client";

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
    <main className="container mx-auto max-w-lg space-y-6 px-4 py-10">
      <h1 className="font-[family-name:var(--font-display)] text-3xl">Account</h1>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          Could not link Discord. Check that the email on your Discord account is verified, then try again.
        </p>
      ) : null}
      <section aria-labelledby="discord-heading" className="space-y-3 panel p-4">
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
    </main>
  );
}
