"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import Loader from "@/components/loader";
import { PlatformName, usePlatformName } from "@/components/platform-name";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

// The AI clients connected to the platform's plugin (Claude, ChatGPT): each can act for the user until disconnected.
function ConnectedApps() {
  const platformName = usePlatformName();
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
          {apps.isPending ? "Loading…" : `No AI app is connected. Connect ${platformName} in Claude or ChatGPT to see it here.`}
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

// The person's own details: the name teams and clients see, the sign-in email, and the password.
function Profile() {
  const session = authClient.useSession();
  const [name, setName] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const user = session.data?.user;
  if (session.isPending || !user) return null;
  const nameValue = name ?? user.name ?? "";

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setProblem(null);
    if (nameValue.trim() === "") {
      setProblem("Enter your name.");
      return;
    }
    if (newPassword !== "" && currentPassword === "") {
      setProblem("Enter your current password to set a new one.");
      return;
    }
    setPending(true);
    try {
      if (nameValue.trim() !== (user?.name ?? "")) {
        const result = await authClient.updateUser({ name: nameValue.trim() });
        if (result.error) throw new Error(result.error.message ?? "Could not save your name.");
      }
      if (newPassword !== "") {
        const result = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: false });
        if (result.error) throw new Error(result.error.message ?? "Could not change your password.");
        setCurrentPassword("");
        setNewPassword("");
      }
      setMessage("Saved.");
      await session.refetch();
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : "Could not save. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="profile-heading" className="panel space-y-4 p-5">
      <h2 id="profile-heading" className="font-medium">Profile</h2>
      <form onSubmit={save} className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="account-name">Name</Label>
          <Input id="account-name" value={nameValue} onChange={(event) => setName(event.target.value)} autoComplete="name" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="account-email">Email</Label>
          <Input id="account-email" value={user.email} disabled readOnly />
          <p className="text-xs text-muted-foreground">Your sign-in email. It cannot be changed here.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="account-current-password">Current password</Label>
          <Input id="account-current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="account-new-password">New password</Label>
          <Input id="account-new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" />
          <p className="text-xs text-muted-foreground">Leave both password fields empty to keep your current password.</p>
        </div>
        {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
        {message ? <p role="status" className="text-sm font-medium text-brand-text">{message}</p> : null}
        <div>
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save profile"}</Button>
        </div>
      </form>
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
      <Profile />
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
            Discord is linked to this account. <PlatformName />
            's Discord commands work for you.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Link Discord to use <PlatformName />
              's commands in your team's server with this <PlatformName /> account.
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
