"use client";

import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useRef, useState } from "react";

import Loader from "@/components/loader";
import { trpc } from "@/utils/trpc";

import { ConfirmDialog } from "./confirm-dialog";

export function PayoutCredentialsCard({ teamSlug }: { teamSlug: string }) {
  const queryClient = useQueryClient();
  const removeDialogRef = useRef<HTMLDialogElement>(null);
  const credentials = useQuery({
    ...trpc.payouts.credentials.queryOptions({ teamSlug }),
    retry: false,
    meta: { silent: true },
  });
  const [replacing, setReplacing] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  // The checklist on the dashboard reads payoutCredentialsSaved from servicesTeam.get.
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.payouts.credentials.queryKey({ teamSlug }) }),
      queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.get.queryKey({ teamSlug }) }),
    ]);
  const save = useMutation(
    trpc.payouts.saveCredentials.mutationOptions({
      onSuccess: async () => {
        setReplacing(false);
        setClientId("");
        setClientSecret("");
        await invalidate();
      },
    }),
  );
  const remove = useMutation(trpc.payouts.removeCredentials.mutationOptions({ onSuccess: invalidate }));

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate({ teamSlug, clientId, clientSecret });
  }

  const saved = credentials.data ?? null;
  const showForm = saved === null || replacing;

  return (
    <section aria-labelledby="credentials-heading" className="space-y-3 border p-4">
      <h2 id="credentials-heading" className="font-medium">
        Payout credentials
      </h2>
      {credentials.isPending ? (
        <Loader />
      ) : credentials.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {credentials.error.message}
        </p>
      ) : (
        <>
          {saved ? (
            <div className="space-y-1 text-sm">
              <p>
                App ending in {saved.clientIdEnding}
                {saved.accountId ? ` · PayPal account ${saved.accountId}` : ""} · checked{" "}
                {new Date(saved.verifiedAt).toLocaleDateString()}
              </p>
              {saved.accountId === null ? (
                <p className="text-muted-foreground">PayPal did not confirm which account these credentials belong to.</p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Payleor sends payouts from your PayPal account with a REST app you create at developer.paypal.com. Payleor
              encrypts the secret and never shows it again.
            </p>
          )}
          {showForm ? (
            <form onSubmit={handleSave} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="payout-client-id">Client ID</Label>
                <Input
                  id="payout-client-id"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="payout-client-secret">Secret</Label>
                <Input
                  id="payout-client-secret"
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </div>
              {save.error ? (
                <p role="alert" className="text-sm text-destructive">
                  {save.error.message}
                </p>
              ) : null}
              <div className="flex gap-2">
                <Button type="submit" disabled={save.isPending || !clientId.trim() || !clientSecret.trim()}>
                  {save.isPending ? "Checking with PayPal…" : "Save credentials"}
                </Button>
                {replacing ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setReplacing(false);
                      setClientId("");
                      setClientSecret("");
                      save.reset();
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            </form>
          ) : (
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setReplacing(true)}>
                Replace
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={remove.isPending}
                onClick={() => {
                  remove.reset();
                  removeDialogRef.current?.showModal();
                }}
              >
                {remove.isPending ? "Removing…" : "Remove"}
              </Button>
            </div>
          )}
          {remove.error ? (
            <p role="alert" className="text-sm text-destructive">
              {remove.error.message}
            </p>
          ) : null}
        </>
      )}
      <ConfirmDialog
        dialogRef={removeDialogRef}
        id="remove-credentials-dialog"
        title="Remove the payout credentials?"
        body="Payleor deletes the encrypted secret. Approved payouts wait until you save credentials again."
        confirmLabel="Remove"
        onConfirm={() => remove.mutate({ teamSlug })}
      />
    </section>
  );
}
