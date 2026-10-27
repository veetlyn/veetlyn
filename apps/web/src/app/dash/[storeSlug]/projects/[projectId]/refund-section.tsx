"use client";

import { canServicesTeam } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import { refundPartStatusLabel, staffRefundAction } from "@/lib/client-refund";
import { formatMinor } from "@/lib/money";
import { trpc } from "@/utils/trpc";

type Detail = inferRouterOutputs<AppRouter>["project"]["get"];

export function RefundSection({
  teamSlug,
  projectId,
  refund,
  payments,
  role,
  clientName,
  onRefunded,
}: {
  teamSlug: string;
  projectId: string;
  refund: NonNullable<Detail["refund"]>;
  payments: Detail["payments"];
  role: Detail["role"];
  clientName: string;
  onRefunded: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const refundClient = useMutation(trpc.project.refundClient.mutationOptions({ onSettled: onRefunded }));

  const amount = formatMinor(refund.amountMinor, refund.currency);
  const action = canServicesTeam(role, "resolve_cases") ? staffRefundAction(refund) : null;
  const kindOf = new Map(payments.map((payment) => [payment.id, payment.kind.replace("_", "-")]));

  function send() {
    dialogRef.current?.close();
    refundClient.mutate({ teamSlug, projectId });
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Refund to the client</h2>
      {refund.status === "completed" && refund.completedAt !== null ? (
        <p className="text-sm">
          Refunded {amount} on {new Date(refund.completedAt).toLocaleDateString()}
        </p>
      ) : (
        <p className="text-sm">The client paid {amount} more than the final price. Send it back to them through PayPal.</p>
      )}
      {refund.parts.length > 0 ? (
        <ul className="space-y-2 text-sm">
          {refund.parts.map((part) => (
            <li key={part.paymentId} className="panel p-3">
              <div className="flex items-center justify-between gap-4">
                <span className="capitalize">
                  {kindOf.get(part.paymentId) ?? "Payment"} · {formatMinor(part.amountMinor, refund.currency)}
                </span>
                <span className="text-muted-foreground">{refundPartStatusLabel(part.status)}</span>
              </div>
              {part.failureMessage ? <p className="mt-1 text-destructive">{part.failureMessage}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {action ? (
        <Button
          disabled={refundClient.isPending}
          onClick={() => {
            refundClient.reset();
            dialogRef.current?.showModal();
          }}
        >
          {action === "retry" ? "Try again" : `Refund ${amount} to the client`}
        </Button>
      ) : null}
      {refundClient.error ? (
        <p role="alert" className="text-sm text-destructive">
          {refundClient.error.message}
        </p>
      ) : null}
      <dialog
        ref={dialogRef}
        aria-labelledby="refund-dialog-title"
        aria-describedby="refund-dialog-body"
        className="m-auto w-[calc(100%-2rem)] max-w-md space-y-4 rounded-xl bg-popover p-6 text-popover-foreground shadow-[var(--float)] backdrop:bg-scrim"
      >
        <h3 id="refund-dialog-title" className="text-lg font-semibold">
          Refund {amount} to {clientName}?
        </h3>
        <p id="refund-dialog-body" className="text-sm text-muted-foreground">
          PayPal sends it from your PayPal account. This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => dialogRef.current?.close()}>
            Cancel
          </Button>
          <Button type="button" onClick={send}>
            Refund {amount}
          </Button>
        </div>
      </dialog>
    </section>
  );
}
