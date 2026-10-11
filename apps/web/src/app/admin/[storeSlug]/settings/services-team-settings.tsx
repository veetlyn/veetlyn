"use client";

import {
  bpsToPercent,
  CURRENCIES,
  MAX_BIO_CHARS,
  PAYOUT_MODES,
  QUOTING_MODES,
  SOLO_MANAGEMENT_FEE_BPS,
  SOLO_TEAM_CUT_BPS,
} from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { Textarea } from "@jendal-workspace/ui/components/textarea";
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
  const result = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });

  const [currency, setCurrency] = useState<string | null>(null);
  const [teamCut, setTeamCut] = useState<string | null>(null);
  const [managementFee, setManagementFee] = useState<string | null>(null);
  const [quotingMode, setQuotingMode] = useState<string | null>(null);
  const [payoutMode, setPayoutMode] = useState<string | null>(null);
  const [bio, setBio] = useState<string | null>(null);

  const save = useMutation(
    trpc.servicesTeam.updateSettings.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.get.queryKey({ teamSlug }) }),
    }),
  );
  const saveBio = useMutation(
    trpc.servicesTeam.updateBio.mutationOptions({
      onSuccess: (data) => {
        // The api stores the trimmed bio; sync the local state so the counter settles.
        setBio(data.bio);
        void queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.get.queryKey({ teamSlug }) });
      },
    }),
  );
  const switchToTeam = useMutation(
    trpc.servicesTeam.switchToTeam.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.get.queryKey({ teamSlug }) }),
    }),
  );

  if (result.isPending) return <Loader />;
  if (result.isError) return <TeamNotFound />;

  const { team, role, settings } = result.data;
  const current = settings ?? undefined;
  const solo = current?.solo ?? false;
  const values = {
    currency: currency ?? current?.currency ?? "USD",
    teamCut: teamCut ?? (current ? bpsToPercent(current.teamCutBps) : "15"),
    managementFee: managementFee ?? (current ? bpsToPercent(current.managementFeeBps) : "10"),
    quotingMode: quotingMode ?? current?.quotingMode ?? "assigned",
    payoutMode: payoutMode ?? current?.payoutMode ?? "manual",
    bio: bio ?? current?.bio ?? "",
  };

  const teamCutField = rateField(values.teamCut);
  const managementFeeField = rateField(values.managementFee);
  const canSave = solo
    ? role === "admin" && !save.isPending
    : role === "admin" && teamCutField.bps !== null && managementFeeField.bps !== null && !save.isPending;
  const bioUnchanged = values.bio.trim() === (current?.bio ?? "");
  const bioTooLong = values.bio.trim().length > MAX_BIO_CHARS;
  const canSaveBio = role === "admin" && !saveBio.isPending && !bioUnchanged && !bioTooLong;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;
    if (solo) {
      save.mutate({
        teamSlug,
        currency: values.currency as "USD" | "EUR",
        teamCutBps: current?.teamCutBps ?? SOLO_TEAM_CUT_BPS,
        managementFeeBps: current?.managementFeeBps ?? SOLO_MANAGEMENT_FEE_BPS,
        quotingMode: current?.quotingMode ?? "assigned",
        payoutMode: current?.payoutMode ?? "manual",
      });
      return;
    }
    if (teamCutField.bps === null || managementFeeField.bps === null) return;
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
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{solo ? "Settings" : "Team settings"}</h1>
      {role !== "admin" ? (
        <p className="mt-2 text-sm text-muted-foreground">Only an admin can change the team settings.</p>
      ) : null}
      <form onSubmit={handleSubmit} className="mt-8 grid gap-6">
        <div className="space-y-2">
          <Label htmlFor="bio">About you</Label>
          <Textarea
            id="bio"
            value={values.bio}
            onChange={(e) => {
              setBio(e.target.value);
              saveBio.reset();
            }}
            rows={3}
            maxLength={1_000}
            placeholder="What you make, for whom, and how you work."
          />
          <p className="text-sm text-muted-foreground">
            Up to {MAX_BIO_CHARS} characters, shown on your seller page. {values.bio.trim().length}/{MAX_BIO_CHARS}
          </p>
          {saveBio.error ? (
            <p role="alert" className="text-sm text-destructive">
              {saveBio.error.message}
            </p>
          ) : null}
          {saveBio.isSuccess ? <p className="text-sm text-emerald-700 dark:text-emerald-400">Saved.</p> : null}
          <Button
            type="button"
            onClick={() => saveBio.mutate({ teamSlug, bio: values.bio })}
            disabled={!canSaveBio}
            className="justify-self-start"
          >
            {saveBio.isPending ? "Saving…" : "Save bio"}
          </Button>
        </div>
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
        {solo ? (
          <p className="border p-3 text-sm text-muted-foreground">
            You work alone, so you keep the whole price. Switch to a team to set a team cut, a management fee and
            payouts.
          </p>
        ) : (
          <>
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
          </>
        )}
        {save.error ? <p className="text-sm text-destructive">{save.error.message}</p> : null}
        {save.isSuccess ? <p className="text-sm text-emerald-700 dark:text-emerald-400">Settings saved.</p> : null}
        <Button type="submit" disabled={!canSave} className="justify-self-start">
          {save.isPending ? "Saving…" : "Save settings"}
        </Button>
      </form>
      {solo && role === "admin" ? (
        <section className="mt-10 grid gap-3 border p-4">
          <h2 className="font-medium">Switch to a team</h2>
          <p className="text-sm text-muted-foreground">
            Your team cut becomes 15% and your management fee 10%. You can add members afterwards.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => switchToTeam.mutate({ teamSlug })}
            disabled={switchToTeam.isPending}
            className="justify-self-start"
          >
            {switchToTeam.isPending ? "Switching…" : "Switch to a team"}
          </Button>
          {switchToTeam.error ? (
            <p role="alert" className="text-sm text-destructive">
              {switchToTeam.error.message}
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
