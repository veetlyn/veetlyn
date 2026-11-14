"use client";

import { Badge } from "@jendal-workspace/ui/components/badge";
import { Button } from "@jendal-workspace/ui/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import Loader from "@/components/loader";
import { PageHeader, WorkPage } from "@/components/page-composition";
import { usePlatformName } from "@/components/platform-name";
import TeamNotFound from "@/components/services-team/team-not-found";
import { SettingsField, SettingsSection } from "@/components/settings-section";
import { trpc } from "@/utils/trpc";

type LinkCode = { code: string; expiresAt: string };

// The command to paste, in a box the eye finds at once, with a copy key beside it.
function CommandBox({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-[10px] bg-foreground/[0.04] py-1.5 pr-1.5 pl-3.5 shadow-[inset_0_0_0_1px_var(--border)]">
      <code className="min-w-0 flex-1 truncate font-mono text-[13px]">{command}</code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={copied ? "Copied" : "Copy command"}
        onClick={() => {
          void navigator.clipboard.writeText(command).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          });
        }}
      >
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export default function DiscordLink({ teamSlug }: { teamSlug: string }) {
  const name = usePlatformName();
  const cmd = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") || "platform";
  const result = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const [createdCode, setCreatedCode] = useState<LinkCode | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const createCode = useMutation(
    trpc.servicesTeam.createDiscordLinkCode.mutationOptions({
      onSuccess: (created) => { setCreatedCode(created); setCreateError(null); },
      onError: (error) => setCreateError(error.message),
    }),
  );

  if (result.isPending) return <Loader />;
  if (result.isError) return <TeamNotFound />;

  const { role, settings } = result.data;
  const linkedGuildId = settings?.discordGuildId ?? null;
  const admin = role === "admin";

  return (
    <WorkPage>
      <PageHeader title="Channels" description={`Where your team works with ${name} outside the dashboard.`} />

      <SettingsSection
        title="Discord"
        description={`Run ${name}'s commands in your team's server. One server per team.`}
        footer={!linkedGuildId && admin ? (
          <>
            <span>{createdCode ? `Expires at ${new Date(createdCode.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : "A code works once and expires after 15 minutes."}</span>
            <Button type="button" size="sm" onClick={() => createCode.mutate({ teamSlug })} disabled={createCode.isPending}>
              {createCode.isPending ? "Creating…" : createdCode ? "Create a new code" : "Create link code"}
            </Button>
          </>
        ) : undefined}
      >
        <SettingsField
          label="Server"
          description={linkedGuildId ? <>Server ID <span className="font-mono">{linkedGuildId}</span></> : admin ? "No server is linked yet." : "No server is linked yet. Only an admin can link one."}
        >
          <Badge tone={linkedGuildId ? "good" : "neutral"}>{linkedGuildId ? "Linked" : "Not linked"}</Badge>
        </SettingsField>

        {!linkedGuildId && admin ? (
          <SettingsField label="How to link" wide>
            <ol className="grid gap-3 text-[13px] leading-5 text-muted-foreground">
              <li className="flex gap-3"><Step n={1} /><span>Link your Discord account to {name} in <Link href="/account" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">Account settings</Link>.</span></li>
              <li className="flex gap-3"><Step n={2} /><span>Create a link code below.</span></li>
              <li className="flex gap-3"><Step n={3} /><span>In your server, run the command. You need the Manage Server permission there.</span></li>
            </ol>
            {createdCode ? <div className="mt-4"><CommandBox command={`/${cmd} link code:${createdCode.code}`} /></div> : null}
            {createError ? <p role="alert" className="mt-3 text-[13px] text-destructive">{createError}</p> : null}
          </SettingsField>
        ) : null}
      </SettingsSection>
    </WorkPage>
  );
}

function Step({ n }: { n: number }) {
  return <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-full bg-foreground/[0.06] text-[12px] font-medium text-foreground tabular-nums">{n}</span>;
}
