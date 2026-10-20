"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { Ban, Check, Eye } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { authClient } from "@/lib/auth-client";
import type { consentGroups } from "@/lib/oauth-consent";

const consentResult = z.object({ url: z.string().min(1) });

function Group({
  title,
  items,
  icon: Icon,
  tone,
}: {
  title: string;
  items: string[];
  icon: typeof Check;
  tone: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</p>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2.5 text-sm">
            <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${tone}`} strokeWidth={1.75} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ConsentForm({
  clientName,
  host,
  account,
  groups,
}: {
  clientName: string | null;
  host: string | null;
  account: { name: string; email: string };
  groups: ReturnType<typeof consentGroups>;
}) {
  const [pending, setPending] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = clientName ?? "An AI assistant";

  async function decide(accept: boolean) {
    setPending(accept ? "allow" : "deny");
    setError(null);
    const result = await authClient.oauth2.consent({ accept });
    const next = consentResult.safeParse(result.data);
    if (next.success) {
      window.location.assign(next.data.url);
      return;
    }
    setPending(null);
    setError(result.error?.message ?? "Could not record your answer. Try again.");
  }

  return (
    <div className="space-y-5 short:space-y-4">
      <div className="space-y-1.5">
        <p className="text-sm text-muted-foreground">Connect an AI assistant</p>
        <h1 className="font-heading text-3xl short:text-2xl">{name} wants to use Payleor as you</h1>
      </div>

      <div className="panel divide-y divide-border">
        <div className="space-y-1 p-4">
          <p className="text-xs text-muted-foreground">After you allow it, Payleor sends you back to</p>
          <p className="font-heading text-xl break-all">{host ?? "an address Payleor cannot read"}</p>
          <p className="text-xs text-muted-foreground">
            Allow only if this is the assistant you are connecting, such as claude.ai or chatgpt.com. The name above is
            the app's own claim; this address is not.
          </p>
        </div>
        <div className="flex items-center gap-3 p-4">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium"
          >
            {account.name.trim().charAt(0).toUpperCase() || "?"}
          </span>
          <span className="min-w-0 text-sm">
            <span className="block truncate font-medium">{account.name}</span>
            <span className="block truncate text-muted-foreground" title={account.email}>
              {account.email}
            </span>
          </span>
        </div>
      </div>

      <div className="space-y-4">
        <Group title="It can see" items={groups.see} icon={Eye} tone="text-muted-foreground" />
        <Group title="It can" items={groups.act} icon={Check} tone="text-brand" />
        <Group title="It can never" items={groups.never} icon={Ban} tone="text-muted-foreground" />
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={() => decide(false)} disabled={pending !== null}>
            {pending === "deny" ? "Denying…" : "Deny"}
          </Button>
          <Button type="button" onClick={() => decide(true)} disabled={pending !== null}>
            {pending === "allow" ? "Allowing…" : "Allow"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">You can disconnect it at any time from your Payleor account.</p>
      </div>
    </div>
  );
}
