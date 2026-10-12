"use client";

import { Button, buttonVariants } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type RefObject, useRef, useState } from "react";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import { formatMinor, minorToPriceInput } from "@/lib/money";
import { trpc } from "@/utils/trpc";

export type TeamPayoutRequest = inferRouterOutputs<AppRouter>["payouts"]["list"]["requests"][number];

function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function show(next: "copied" | "failed") {
    if (timer.current) clearTimeout(timer.current);
    setState(next);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => show("copied"),
          () => show("failed"),
        );
      }}
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Could not copy" : label}
    </Button>
  );
}

export function MarkPaidDialog({
  dialogRef,
  teamSlug,
  request,
  sendMoneyUrl,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  teamSlug: string;
  request: TeamPayoutRequest;
  sendMoneyUrl: string;
}) {
  const queryClient = useQueryClient();
  // null follows the requested amount, so the field refills when the form resets.
  const [received, setReceived] = useState<string | null>(null);
  const [transactionId, setTransactionId] = useState("");
  const markPaid = useMutation(
    trpc.payouts.markPaid.mutationOptions({
      onSuccess: async () => {
        dialogRef.current?.close();
        setReceived(null);
        setTransactionId("");
        await queryClient.invalidateQueries({ queryKey: trpc.payouts.list.queryKey({ teamSlug }) });
      },
    }),
  );

  const amount = formatMinor(request.amountMinor, request.currency);
  const receivedValue = received ?? minorToPriceInput(request.amountMinor);
  const id = `mark-paid-${request.id}`;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    markPaid.mutate({
      teamSlug,
      requestId: request.id,
      received: receivedValue.trim(),
      paypalTransactionId: transactionId.trim(),
    });
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${id}-title`}
      onClose={() => {
        if (!markPaid.isPending) markPaid.reset();
      }}
      className="m-auto w-full max-w-md space-y-4 rounded-lg border bg-background p-6 text-foreground backdrop:bg-black/50"
    >
      <h3 id={`${id}-title`} className="text-lg font-semibold">
        Pay {request.memberName} {amount}
      </h3>
      <ol className="list-decimal space-y-4 pl-5 text-sm">
        <li className="space-y-3">
          <p>
            Open PayPal and send <span className="font-medium">{amount}</span> to{" "}
            <span className="font-medium break-all">{request.receiverEmail}</span> as a payment for goods or services.
            PayPal takes its fee from what they receive.
          </p>
          <div className="flex flex-wrap gap-2">
            <a href={sendMoneyUrl} target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm" })}>
              Open PayPal
            </a>
            <CopyButton text={request.receiverEmail} label="Copy email" />
            <CopyButton text={minorToPriceInput(request.amountMinor)} label="Copy amount" />
          </div>
        </li>
        <li className="space-y-3">
          <p>Mark it paid.</p>
          <form id={`${id}-form`} onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor={`${id}-received`}>Amount they received ({request.currency})</Label>
              <Input
                id={`${id}-received`}
                value={receivedValue}
                onChange={(e) => setReceived(e.target.value)}
                inputMode="decimal"
                className="max-w-40"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-transaction`}>PayPal transaction ID (optional)</Label>
              <Input
                id={`${id}-transaction`}
                value={transactionId}
                onChange={(e) => setTransactionId(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            {markPaid.error ? (
              <p role="alert" className="text-destructive">
                {markPaid.error.message}
              </p>
            ) : null}
          </form>
        </li>
      </ol>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => dialogRef.current?.close()}>
          Cancel
        </Button>
        <Button type="submit" form={`${id}-form`} disabled={markPaid.isPending}>
          {markPaid.isPending ? "Marking as paid…" : "Mark as paid"}
        </Button>
      </div>
    </dialog>
  );
}
