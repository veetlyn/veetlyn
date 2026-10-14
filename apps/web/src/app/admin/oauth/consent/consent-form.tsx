"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { useEffect, useState } from "react";
import { z } from "zod";

import { authClient } from "@/lib/auth-client";

const consentResult = z.object({ url: z.string().min(1) });

const publicClient = z.object({ client_name: z.string().min(1) });

export default function ConsentForm({ clientId, scopes }: { clientId: string; scopes: string[] }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientName, setClientName] = useState(clientId);

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
      <p>
        <strong>{clientName}</strong> wants to use Payleor on your behalf.
      </p>
      <ul className="list-disc pl-5 text-sm">
        {scopes.map((scope) => (
          <li key={scope}>{scope}</li>
        ))}
      </ul>
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
