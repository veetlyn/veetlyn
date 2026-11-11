"use client";

import { maskedPayPalAccountId } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { buttonVariants } from "@jendal-workspace/ui/lib/button-variants";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import Loader from "@/components/loader";
import { PlatformName } from "@/components/platform-name";
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

  // The same PayPal consent turns automatic payouts on and reconnects them with more permissions.
  function connectFlow(label: string) {
    return (
      <>
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
            {start.isPending ? "Connecting…" : label}
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
              PayPal opens in a small secure window and shares this team's payout access with <PlatformName />.
            </p>
            {complete.isPending ? (
              <p className="text-sm text-muted-foreground">Checking the connection with PayPal…</p>
            ) : null}
          </div>
        )}
      </>
    );
  }

  // A status row, not a setup panel: the payout queue owns this page, so turning automatic payouts on sits behind a
  // disclosure that states what it changes before anyone connects PayPal.
  return (
    <section aria-labelledby="automatic-payouts-heading" className="panel space-y-3 px-5 py-4 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h2 id="automatic-payouts-heading" className="font-medium">
          Automatic payouts
          {saved ? <span className="font-normal text-muted-foreground"> · On</span> : null}
          {credentials.data === null ? <span className="font-normal text-muted-foreground"> · Off</span> : null}
        </h2>
        {saved ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={remove.isPending}
            onClick={() => {
              remove.reset();
              offDialogRef.current?.showModal();
            }}
          >
            {remove.isPending ? "Turning off…" : "Turn off"}
          </Button>
        ) : null}
      </div>
      {credentials.isPending ? (
        <Loader />
      ) : credentials.isError ? (
        <p role="alert" className="text-destructive">
          {credentials.error.message}
        </p>
      ) : saved ? (
        <div className="space-y-3">
          <p className="text-muted-foreground">
            Approved payouts are sent from{" "}
            {saved.accountId === null ? "this team's PayPal account" : maskedPayPalAccountId(saved.accountId)}. Verified{" "}
            {new Date(saved.verifiedAt).toLocaleDateString()}.
          </p>
          {saved.canReadBalance ? null : (
            <div className="space-y-3">
              <p>
                Reconnect so <PlatformName /> can read your PayPal balance.
              </p>
              {connectFlow("Reconnect")}
            </div>
          )}
          {remove.error ? (
            <p role="alert" className="text-destructive">
              {remove.error.message}
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <p className="text-muted-foreground">Approved payouts wait until you export them for PayPal Payouts Web.</p>
          {/* Kept open while PayPal's window is in use, so the flow and its errors stay visible. */}
          <details open={connect !== null || start.isPending || complete.isPending || undefined}>
            <summary className="cursor-pointer font-medium">Set up automatic payouts</summary>
            <div className="mt-3 space-y-3">
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                <li>
                  Once on, approving a payout sends it from this team&apos;s PayPal balance, on payday if the team has one. No
                  export step.
                </li>
                <li>Who has to approve, and any limits, still come from your payout rules.</li>
                <li>PayPal&apos;s fee comes off each payout. You can turn this off at any time.</li>
              </ul>
              {connectFlow("Connect PayPal for automatic payouts")}
            </div>
          </details>
        </>
      )}
      <ConfirmDialog
        dialogRef={offDialogRef}
        id="turn-off-payouts-dialog"
        title="Turn off automatic payouts?"
        body="Approved payouts then wait until you export them for PayPal Payouts Web or turn automatic payouts on again."
        confirmLabel="Turn off"
        onConfirm={() => remove.mutate({ teamSlug })}
      />
    </section>
  );
}
