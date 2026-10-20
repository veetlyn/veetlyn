"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { useEffect, useState } from "react";
import { z } from "zod";

import { authClient } from "@/lib/auth-client";
import { consentHost, scopeLabels } from "@/lib/oauth-consent";

const consentResult = z.object({ url: z.string().min(1) });

const publicClient = z.object({ client_name: z.string().min(1) });

export default function ConsentForm({
  clientId,
  scopes,
  redirectUri,
}: {
  clientId: string;
  scopes: string[];
  redirectUri: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string | null>(null);
  const host = consentHost(redirectUri);

  useEffect(() => {
    void authClient.oauth2.publicClient({ query: { client_id: clientId } }).then((result) => {
      const parsed = publicClient.safeParse(result.data);
      if (parsed.success) setClientName(parsed.data.client_name);
    });
  }, [clientId]);

  async function decide(accept: boolean) {
    setPending(true);
    setError(null);
    const result = await authClient.oauth2.consent({ accept });
    const next = consentResult.safeParse(result.data);
    if (next.success) {
      window.location.assign(next.data.url);
      return;
    }
    setPending(false);
    setError(result.error?.message ?? "Could not record your answer. Try again.");
  }

  return (
    <div className="space-y-4">
      <p className="text-sm">
        An app that calls itself <strong>{clientName ?? "an AI assistant"}</strong> wants to use Payleor as you.
      </p>
      <div className="panel space-y-1 p-3">
        <p className="text-sm text-muted-foreground">After you allow it, you go back to</p>
        <p className="font-medium break-all">{host ?? "an address Payleor cannot read"}</p>
        <p className="text-sm text-muted-foreground">Allow only if this is the assistant you are connecting, such as claude.ai or chatgpt.com.</p>
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">It will be able to</p>
        <ul className="list-disc space-y-0.5 pl-5 text-sm">
          {scopeLabels(scopes).map((label) => (
            <li key={label}>{label}</li>
          ))}
          <li>Search offerings, request quotes and reply to teams for you</li>
          <li>Show you quotes and payments; you accept and pay yourself</li>
        </ul>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" onClick={() => decide(true)} disabled={pending}>
          Allow
        </Button>
        <Button type="button" variant="outline" onClick={() => decide(false)} disabled={pending}>
          Deny
        </Button>
      </div>
    </div>
  );
}
