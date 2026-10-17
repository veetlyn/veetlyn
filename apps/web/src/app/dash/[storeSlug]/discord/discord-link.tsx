"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import Loader from "@/components/loader";
import TeamNotFound from "@/components/services-team/team-not-found";
import { trpc } from "@/utils/trpc";

type LinkCode = { code: string; expiresAt: string };

export default function DiscordLink({ teamSlug }: { teamSlug: string }) {
  const result = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const [createdCode, setCreatedCode] = useState<LinkCode | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const createCode = useMutation(
    trpc.servicesTeam.createDiscordLinkCode.mutationOptions({
      onSuccess: (created) => setCreatedCode(created),
      onError: (error) => setCreateError(error.message),
    }),
  );

  if (result.isPending) return <Loader />;
  if (result.isError) return <TeamNotFound />;

  const { team, role, settings } = result.data;
  const linkedGuildId = settings?.discordGuildId ?? null;

  return (
    <main className="container mx-auto max-w-lg space-y-6 px-4 py-10">
      <Link href={`/${team.slug}`} className="text-sm text-muted-foreground">
        {team.name}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Link Discord</h1>
      {linkedGuildId ? (
        <section aria-labelledby="linked-heading" className="space-y-2 border p-4">
          <h2 id="linked-heading" className="font-medium">
            Your team is linked
          </h2>
          <p className="text-sm text-muted-foreground">Server ID: {linkedGuildId}</p>
          <p className="text-sm text-muted-foreground">
            Payleor's commands work in that server. One server per team; an admin can link again to change it.
          </p>
        </section>
      ) : role !== "admin" ? (
        <p className="text-sm text-muted-foreground">Only an admin can link the Discord server.</p>
      ) : (
        <section aria-labelledby="create-code-heading" className="space-y-3 border p-4">
          <h2 id="create-code-heading" className="font-medium">
            Create a link code
          </h2>
          <p className="text-sm text-muted-foreground">
            Create a one-time code, then run <code>/payleor link code:…</code> in your server. You need the Manage
            Server permission there, and your Discord account must be linked to this Payleor account in Account
            settings. The code expires 15 minutes after you create it.
          </p>
          <Button
            type="button"
            onClick={() => createCode.mutate({ teamSlug })}
            disabled={createCode.isPending}
          >
            {createCode.isPending ? "Creating…" : createdCode ? "Create a new code" : "Create link code"}
          </Button>
          {createError ? (
            <p role="alert" className="text-sm text-destructive">
              {createError}
            </p>
          ) : null}
          {createdCode ? (
            <div className="space-y-2 border-t pt-3">
              <p className="text-sm">In your server, run:</p>
              <p className="break-all font-mono text-sm">/payleor link code:{createdCode.code}</p>
              <p className="text-sm text-muted-foreground">
                Expires {new Date(createdCode.expiresAt).toLocaleTimeString()} ({createdCode.expiresAt}).
              </p>
            </div>
          ) : null}
        </section>
      )}
    </main>
  );
}
