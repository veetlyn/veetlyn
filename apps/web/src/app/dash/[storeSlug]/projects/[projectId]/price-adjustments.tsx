"use client";

import { canServicesTeam } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import { formatMinor, minorToPriceInput, parsePriceInput } from "@/lib/money";
import { trpc } from "@/utils/trpc";

type Detail = inferRouterOutputs<AppRouter>["project"]["get"];

// The api prefixes rule refusals with a code for agents; people read the sentence after it.
const ERROR_CODE_PREFIX = /^[A-Z_]+: /;

// Refunds off the final price stay open until the client accepts the delivery.
const PRICE_OPEN = new Set<Detail["project"]["status"]>(["in_progress", "delivered"]);

export function LateRefundNotice({
  teamSlug,
  project,
  role,
  onChanged,
}: {
  teamSlug: string;
  project: Detail["project"];
  role: Detail["role"];
  onChanged: () => Promise<void>;
}) {
  const decide = useMutation(trpc.project.decideLateRefund.mutationOptions({ onSuccess: onChanged }));
  if (!project.lateRefundStatus || project.lateRefundProposedMinor === null) return null;
  const amount = formatMinor(project.lateRefundProposedMinor, project.currency);
  const days = project.lateRefundDaysLate === 1 ? "1 day" : `${project.lateRefundDaysLate ?? 0} days`;

  if (project.lateRefundStatus === "confirmed") {
    return <p className="text-sm">Late-delivery refund of {amount} confirmed. It comes off the final price and the member's share.</p>;
  }
  if (project.lateRefundStatus === "waived") {
    return <p className="text-sm text-muted-foreground">Late-delivery refund of {amount} waived.</p>;
  }
  const canDecide = canServicesTeam(role, "resolve_cases") && PRICE_OPEN.has(project.status);
  return (
    <section role="status" className="panel space-y-3 p-4">
      <p className="font-medium text-warning">Delivered {days} late.</p>
      <p className="text-sm text-muted-foreground">
        The team rules propose a {amount} refund to the client, paid from the member's share. Nothing moves until an admin
        decides, and the decision closes when the client accepts the delivery.
      </p>
      {canDecide ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ teamSlug, projectId: project.id, decision: "confirm" })}
          >
            Confirm refund
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ teamSlug, projectId: project.id, decision: "waive" })}
          >
            Waive
          </Button>
        </div>
      ) : null}
      {decide.error ? (
        <p role="alert" className="text-sm text-destructive">
          {decide.error.message}
        </p>
      ) : null}
    </section>
  );
}

export function QualityRefundForm({
  teamSlug,
  project,
  role,
  capMinor,
  onChanged,
}: {
  teamSlug: string;
  project: Detail["project"];
  role: Detail["role"];
  capMinor: Detail["qualityRefundCapMinor"];
  onChanged: () => Promise<void>;
}) {
  const [amount, setAmount] = useState<string | null>(null);
  const save = useMutation(
    trpc.project.setQualityRefund.mutationOptions({
      onSuccess: async () => {
        setAmount(null);
        await onChanged();
      },
    }),
  );
  if (!canServicesTeam(role, "resolve_cases") || !PRICE_OPEN.has(project.status) || !project.rulebookId) return null;
  const current = project.qualityRefundMinor;
  const value = amount ?? (current === null ? "" : minorToPriceInput(current));
  const amountMinor = value.trim() === "" ? 0 : parsePriceInput(value);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (amountMinor === null) return;
    save.mutate({ teamSlug, projectId: project.id, amountMinor });
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Quality refund</h2>
      <p className="text-sm text-muted-foreground">
        {current === null
          ? "Lower the final price when the work falls short."
          : `${formatMinor(current, project.currency)} comes off the final price.`}{" "}
        The team, manager and member shares shrink with it.
        {capMinor !== null ? ` The team rules allow up to ${formatMinor(capMinor, project.currency)} at this stage.` : ""}
      </p>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2">
        <div className="space-y-2">
          <Label htmlFor="quality-refund">Amount ({project.currency})</Label>
          <Input
            id="quality-refund"
            inputMode="decimal"
            value={value}
            placeholder="0.00"
            onChange={(e) => {
              save.reset();
              setAmount(e.target.value);
            }}
          />
        </div>
        <Button type="submit" variant="outline" disabled={save.isPending || amountMinor === null}>
          {save.isPending ? "Saving…" : "Save refund"}
        </Button>
      </form>
      {amountMinor === null ? <p className="text-sm text-destructive">Enter an amount like 25.00.</p> : null}
      {save.error ? (
        <p role="alert" className="text-sm text-destructive">
          {save.error.message.replace(ERROR_CODE_PREFIX, "")}
        </p>
      ) : null}
    </section>
  );
}
