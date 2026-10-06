"use client";

import { bpsToPercent, CURRENCIES, PAYOUT_MODES, QUOTING_MODES } from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type FormEvent, useState } from "react";

import Loader from "@/components/loader";
import TeamNotFound from "@/components/services-team/team-not-found";
import { PAYOUT_MODE_LABELS, QUOTING_MODE_LABELS } from "@/lib/services-team-labels";
import { rateField } from "@/lib/services-team-settings-form";
import { trpc } from "@/utils/trpc";

const SELECT_CLASS = "h-9 w-full rounded-md border bg-transparent px-3 text-sm";

function RateInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const field = rateField(value);
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        aria-invalid={field.problem !== null}
        aria-describedby={`${id}-problem`}
        required
      />
      <p id={`${id}-problem`} className="min-h-5 text-sm text-destructive">
        {field.problem}
      </p>
    </div>
  );
}

export default function ServicesTeamSettings({ teamSlug }: { teamSlug: string }) {
  const queryClient = useQueryClient();
  const result = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false });

  const [currency, setCurrency] = useState<string | null>(null);
  const [teamCut, setTeamCut] = useState<string | null>(null);
  const [managementFee, setManagementFee] = useState<string | null>(null);
  const [quotingMode, setQuotingMode] = useState<string | null>(null);
  const [payoutMode, setPayoutMode] = useState<string | null>(null);

  const save = useMutation(
    trpc.servicesTeam.updateSettings.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.get.queryKey({ teamSlug }) }),
    }),
  );

  if (result.isPending) return <Loader />;
  if (result.isError) return <TeamNotFound />;

  const { team, role, settings } = result.data;
  const current = settings ?? undefined;
  const values = {
    currency: currency ?? current?.currency ?? "USD",
    teamCut: teamCut ?? (current ? bpsToPercent(current.teamCutBps) : "15"),
    managementFee: managementFee ?? (current ? bpsToPercent(current.managementFeeBps) : "10"),
    quotingMode: quotingMode ?? current?.quotingMode ?? "assigned",
    payoutMode: payoutMode ?? current?.payoutMode ?? "manual",
  };

  const teamCutField = rateField(values.teamCut);
  const managementFeeField = rateField(values.managementFee);
  const canSave =
    role === "admin" && teamCutField.bps !== null && managementFeeField.bps !== null && !save.isPending;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave || teamCutField.bps === null || managementFeeField.bps === null) return;
    save.mutate({
      teamSlug,
      currency: values.currency as "USD" | "EUR",
      teamCutBps: teamCutField.bps,
      managementFeeBps: managementFeeField.bps,
      quotingMode: values.quotingMode as "open" | "assigned" | "team",
      payoutMode: values.payoutMode as "manual" | "rules" | "automatic",
    });
  }

  return (
    <main className="container mx-auto max-w-lg px-4 py-10">
      <Link href={`/${team.slug}`} className="text-sm text-muted-foreground">
        {team.name}
      </Link>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Team settings</h1>
      {role !== "admin" ? (
        <p className="mt-2 text-sm text-muted-foreground">Only an admin can change the team settings.</p>
      ) : null}
      <form onSubmit={handleSubmit} className="mt-8 grid gap-6">
        <div className="space-y-2">
          <Label htmlFor="currency">Currency</Label>
          <select
            id="currency"
            className={SELECT_CLASS}
            value={values.currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <RateInput id="team-cut" label="Team cut (%)" value={values.teamCut} onChange={setTeamCut} />
        <RateInput
          id="management-fee"
          label="Management fee (%)"
          value={values.managementFee}
          onChange={setManagementFee}
        />
        <div className="space-y-2">
          <Label htmlFor="quoting-mode">Quoting</Label>
          <select
            id="quoting-mode"
            className={SELECT_CLASS}
            value={values.quotingMode}
            onChange={(e) => setQuotingMode(e.target.value)}
          >
            {QUOTING_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {QUOTING_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="payout-mode">Payouts</Label>
          <select
            id="payout-mode"
            className={SELECT_CLASS}
            value={values.payoutMode}
            onChange={(e) => setPayoutMode(e.target.value)}
          >
            {PAYOUT_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {PAYOUT_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
        </div>
        {save.error ? <p className="text-sm text-destructive">{save.error.message}</p> : null}
        {save.isSuccess ? <p className="text-sm text-emerald-700 dark:text-emerald-400">Settings saved.</p> : null}
        <Button type="submit" disabled={!canSave} className="justify-self-start">
          {save.isPending ? "Saving…" : "Save settings"}
        </Button>
      </form>
    </main>
  );
}
