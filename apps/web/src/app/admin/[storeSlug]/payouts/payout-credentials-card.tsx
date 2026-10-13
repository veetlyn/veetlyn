"use client";

import { maskedPayPalAccountId } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { buttonVariants } from "@jendal-workspace/ui/lib/button-variants";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import Loader from "@/components/loader";
import { payPalOnboardingLinks } from "@/lib/paypal-onboarding";
import { trpc } from "@/utils/trpc";

import { ConfirmDialog } from "./confirm-dialog";

declare global {
  interface Window {
    onPayPalConnected?: (authCode: string, sharedId: string) => void;
    PAYPAL?: {
      apps?: {
        Signup?: {
          setup?: () => void;
          MiniBrowser?: { init?: () => void };
        };
      };
    };
  }
}

const PARTNER_SCRIPT_ID = "paypal-onboard-partner-js";

type Connect = { attemptId: string; miniBrowserHref: string; partnerScriptSrc: string };

// partner.js binds every [data-paypal-button] anchor present while it loads, so reload it each time a fresh
// action URL renders; the zoid script it pulls in stays loaded, and binds again from setup() here.
function loadPartnerScript(src: string) {
  document.getElementById(PARTNER_SCRIPT_ID)?.remove();
  const script = document.createElement("script");
  script.id = PARTNER_SCRIPT_ID;
  script.src = src;
  script.onload = () => {
    const signup = window.PAYPAL?.apps?.Signup;
    if (signup?.setup) signup.setup();
    else signup?.MiniBrowser?.init?.();
  };
  document.body.appendChild(script);
}

export function PayoutCredentialsCard({ teamSlug }: { teamSlug: string }) {
  const queryClient = useQueryClient();
  const offDialogRef = useRef<HTMLDialogElement>(null);
  const credentials = useQuery({
    ...trpc.payouts.credentials.queryOptions({ teamSlug }),
    retry: false,
    meta: { silent: true },
  });
  const [connect, setConnect] = useState<Connect | null>(null);
  const [linkProblem, setLinkProblem] = useState(false);
  // PayPal can call onPayPalConnected more than once for one consent, and its authorization code works only once.
  const completedAttemptsRef = useRef(new Set<string>());

  // The checklist on the dashboard reads payoutCredentialsSaved from servicesTeam.get.
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.payouts.credentials.queryKey({ teamSlug }) }),
      queryClient.invalidateQueries({ queryKey: trpc.payouts.list.queryKey({ teamSlug }) }),
      queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.get.queryKey({ teamSlug }) }),
    ]);
  const start = useMutation(
    trpc.payouts.connectStart.mutationOptions({
      onSuccess: (result) => {
        const links = payPalOnboardingLinks(result.actionUrl);
        setLinkProblem(links === null);
        setConnect(links ? { attemptId: result.attemptId, ...links } : null);
      },
    }),
  );
  const complete = useMutation(
    trpc.payouts.connectComplete.mutationOptions({
      onSuccess: async () => {
        setConnect(null);
        await invalidate();
      },
      // A failed completion leaves no reusable attempt, so the flow restarts from the button.
      onError: () => setConnect(null),
    }),
  );
  const remove = useMutation(trpc.payouts.removeCredentials.mutationOptions({ onSuccess: invalidate }));

  function handleTurnOn() {
    start.reset();
    complete.reset();
    setLinkProblem(false);
    start.mutate({ teamSlug });
  }

  // PayPal calls the global named in data-paypal-onboard-complete with the authorization code when the
  // mini-browser finishes; it must exist before partner.js binds the anchor.
  const onboardAnchorRef = useCallback(
    (anchor: HTMLAnchorElement | null) => {
      if (anchor === null || connect === null) return undefined;
      const { attemptId } = connect;
      window.onPayPalConnected = (authCode, sharedId) => {
        if (completedAttemptsRef.current.has(attemptId)) return;
        completedAttemptsRef.current.add(attemptId);
        complete.mutate({ teamSlug, attemptId, authCode, sharedId });
      };
      loadPartnerScript(connect.partnerScriptSrc);
      return () => {
        delete window.onPayPalConnected;
      };
    },
    [teamSlug, connect, complete.mutate],
  );

  const saved = credentials.data ?? null;

  return (
    <section aria-labelledby="automatic-payouts-heading" className="space-y-3 border p-4">
      <h2 id="automatic-payouts-heading" className="font-medium">
        Automatic payouts
      </h2>
      {credentials.isPending ? (
        <Loader />
      ) : credentials.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {credentials.error.message}
        </p>
      ) : saved ? (
        <div className="space-y-3">
          <div className="space-y-1 text-sm">
            <p>
              On. Payouts are sent from{" "}
              {saved.accountId === null ? "this team's PayPal account" : maskedPayPalAccountId(saved.accountId)}.
            </p>
            <p className="text-muted-foreground">Verified {new Date(saved.verifiedAt).toLocaleDateString()}.</p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={remove.isPending}
              onClick={() => {
                remove.reset();
                offDialogRef.current?.showModal();
              }}
            >
              {remove.isPending ? "Turning off…" : "Turn off automatic payouts"}
            </Button>
          </div>
          {remove.error ? (
            <p role="alert" className="text-sm text-destructive">
              {remove.error.message}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Payleor sends members' payouts from this team's PayPal balance. PayPal's fee comes off each payout.
          </p>
          {start.error ? (
            <p role="alert" className="text-sm text-destructive">
              {start.error.message}
            </p>
          ) : null}
          {complete.error ? (
            <p role="alert" className="text-sm text-destructive">
              {complete.error.message}
            </p>
          ) : null}
          {linkProblem ? (
            <p role="alert" className="text-sm text-destructive">
              PayPal sent a link this page cannot use. Try again.
            </p>
          ) : null}
          {connect === null ? (
            <Button type="button" disabled={start.isPending} onClick={handleTurnOn}>
              {start.isPending ? "Connecting…" : "Turn on automatic payouts"}
            </Button>
          ) : (
            <div className="space-y-2">
              <a
                ref={onboardAnchorRef}
                id="paypal-onboard-link"
                data-paypal-button="true"
                data-paypal-onboard-complete="onPayPalConnected"
                href={connect.miniBrowserHref}
                target="PPFrame"
                className={buttonVariants()}
              >
                Continue in PayPal
              </a>
              <p className="text-sm text-muted-foreground">
                PayPal opens in a small secure window and shares this team's payout access with Payleor.
              </p>
              {complete.isPending ? (
                <p className="text-sm text-muted-foreground">Checking the connection with PayPal…</p>
              ) : null}
            </div>
          )}
        </div>
      )}
      <ConfirmDialog
        dialogRef={offDialogRef}
        id="turn-off-payouts-dialog"
        title="Turn off automatic payouts?"
        body="Members' payout requests wait until you turn them on again."
        confirmLabel="Turn off"
        onConfirm={() => remove.mutate({ teamSlug })}
      />
    </section>
  );
}
