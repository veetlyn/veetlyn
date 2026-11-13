"use client";

import { nativeSelectClass } from "@jendal-workspace/ui/lib/native-select";
import {
  bpsToPercent,
  CURRENCIES,
  type Currency,
  isCurrency,
  isQuotingMode,
  MAX_BIO_CHARS,
  QUOTING_MODES,
  type QuotingMode,
  SOLO_MANAGEMENT_FEE_BPS,
  SOLO_TEAM_CUT_BPS,
} from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Label } from "@jendal-workspace/ui/components/label";
import { Textarea } from "@jendal-workspace/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";

import Loader from "@/components/loader";
import { WorkPage } from "@/components/page-composition";
import { ValueInput } from "@/components/value-input";
import TeamNotFound from "@/components/services-team/team-not-found";
import { QUOTING_MODE_LABELS } from "@/lib/services-team-labels";
import { rateField } from "@/lib/services-team-settings-form";
import { trpc } from "@/utils/trpc";

const SELECT_CLASS = `w-full max-w-64 ${nativeSelectClass}`;

function SettingsRow({ id, label, description, children }: { id: string; label: string; description: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-4 border-b py-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:gap-8">
      <div className="space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0 space-y-3">{children}</div>
    </div>
  );
}

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
    <SettingsRow id={id} label={label} description={id === "team-cut" ? "The percentage of the quoted price kept by the team." : "The percentage added to the quoted price and paid by the client."}>
      <ValueInput
        id={id}
        unit="%"
        unitLabel="percent"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        aria-invalid={field.problem !== null}
        aria-describedby={field.problem ? `${id}-problem` : undefined}
        required
      />
      {field.problem ? <p id={`${id}-problem`} className="text-sm text-destructive">
        {field.problem}
      </p> : null}
    </SettingsRow>
  );
}

export default function ServicesTeamSettings({ teamSlug }: { teamSlug: string }) {
  const queryClient = useQueryClient();
  const result = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });

  const [currency, setCurrency] = useState<Currency | null>(null);
  const [teamCut, setTeamCut] = useState<string | null>(null);
  const [managementFee, setManagementFee] = useState<string | null>(null);
  const [quotingMode, setQuotingMode] = useState<QuotingMode | null>(null);
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

  const { role, settings } = result.data;
  const current = settings ?? undefined;
  const solo = current?.solo ?? false;
  const values = {
    currency: currency ?? current?.currency ?? "USD",
    teamCut: teamCut ?? (current ? bpsToPercent(current.teamCutBps) : "15"),
    managementFee: managementFee ?? (current ? bpsToPercent(current.managementFeeBps) : "10"),
    quotingMode: quotingMode ?? current?.quotingMode ?? "assigned",
    bio: bio ?? current?.bio ?? "",
  };

  const teamCutField = rateField(values.teamCut);
  const managementFeeField = rateField(values.managementFee);
  const settingsChanged = current?.settingsSavedAt == null || values.currency !== current.currency || (!solo && (
    teamCutField.bps !== current.teamCutBps || managementFeeField.bps !== current.managementFeeBps || values.quotingMode !== current.quotingMode
  ));
  const bioUnchanged = values.bio.trim() === (current?.bio ?? "");
  const bioTooLong = values.bio.trim().length > MAX_BIO_CHARS;
  const canSave = (settingsChanged || (!bioUnchanged && !bioTooLong)) && (solo
    ? role === "admin" && !save.isPending && !saveBio.isPending
    : role === "admin" && teamCutField.bps !== null && managementFeeField.bps !== null && !save.isPending && !saveBio.isPending);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;
    if (!bioUnchanged && !bioTooLong) saveBio.mutate({ teamSlug, bio: values.bio });
    if (!settingsChanged) return;
    if (solo) {
      save.mutate({
        teamSlug,
        currency: values.currency,
        teamCutBps: current?.teamCutBps ?? SOLO_TEAM_CUT_BPS,
        managementFeeBps: current?.managementFeeBps ?? SOLO_MANAGEMENT_FEE_BPS,
        quotingMode: current?.quotingMode ?? "assigned",
      });
      return;
    }
    if (teamCutField.bps === null || managementFeeField.bps === null) return;
    save.mutate({
      teamSlug,
      currency: values.currency,
      teamCutBps: teamCutField.bps,
      managementFeeBps: managementFeeField.bps,
      quotingMode: values.quotingMode,
    });
  }

  if (role !== "admin") {
    return (
      <WorkPage>
        <h1 className="font-heading text-3xl">General</h1>
        <p className="mt-2 text-sm text-muted-foreground">Your seller page, currency and defaults for new work.</p>
        <p className="mt-2 text-sm text-muted-foreground">Only an admin can change the team settings.</p>
        <dl className="mt-6">
          <SettingsRow id="bio-readonly" label="About you" description="What clients see on the seller page.">
            <p className="text-sm whitespace-pre-line">{values.bio.trim() ? values.bio : "No bio yet."}</p>
          </SettingsRow>
          <SettingsRow id="currency-readonly" label="Currency" description="The default currency for new quotes.">
            <p className="text-sm">{values.currency}</p>
          </SettingsRow>
          {!solo ? (
            <SettingsRow id="quoting-mode-readonly" label="Who can quote" description="Who prepares and sends quotes for new requests.">
              <p className="text-sm">{QUOTING_MODE_LABELS[values.quotingMode]}</p>
            </SettingsRow>
          ) : null}
        </dl>
      </WorkPage>
    );
  }

  return (
    <WorkPage>
      <h1 className="font-heading text-3xl">General</h1>
      <p className="mt-2 text-sm text-muted-foreground">Your seller page, currency and defaults for new work.</p>
      <form onSubmit={handleSubmit} className="mt-6">
        <fieldset className="min-w-0">
        <SettingsRow id="bio" label="About you" description="Tell clients what you make, for whom, and how you work. This appears on your seller page.">
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
          {saveBio.isSuccess ? <p role="status" className="text-sm font-medium text-brand-text">Saved.</p> : null}
          <p className="text-sm text-muted-foreground">Saved with the settings below.</p>
        </SettingsRow>
        <SettingsRow id="currency" label="Currency" description="The default currency for new quotes. Existing projects keep their currency.">
          <select
            id="currency"
            className={`w-32 ${nativeSelectClass}`}
            value={values.currency}
            onChange={(e) => {
              if (isCurrency(e.target.value)) { setCurrency(e.target.value); save.reset(); }
            }}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </SettingsRow>
        {solo ? (
          <p className="panel p-3 text-sm text-muted-foreground">
            You work alone, so you keep the whole price. Switch to a team to set a team cut, a management fee and
            payouts.
          </p>
        ) : (
          <>
            <RateInput id="team-cut" label="Team cut" value={values.teamCut} onChange={(value) => { setTeamCut(value); save.reset(); }} />
            <RateInput
              id="management-fee"
              label="Management fee"
              value={values.managementFee}
              onChange={(value) => { setManagementFee(value); save.reset(); }}
            />
            <SettingsRow id="quoting-mode" label="Who can quote" description="Choose who prepares and sends quotes for new requests.">
              <select
                id="quoting-mode"
                className={SELECT_CLASS}
                value={values.quotingMode}
                onChange={(e) => {
                  if (isQuotingMode(e.target.value)) { setQuotingMode(e.target.value); save.reset(); }
                }}
              >
                {QUOTING_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {QUOTING_MODE_LABELS[mode]}
                  </option>
                ))}
              </select>
            </SettingsRow>
          </>
        )}
        <div className="flex flex-wrap items-center justify-end gap-4 pt-5">
        {save.error ? <p role="alert" className="text-sm text-destructive">{save.error.message}</p> : null}
        {save.isSuccess ? <p role="status" className="text-sm font-medium text-brand-text">Settings saved.</p> : null}
        <Button type="submit" disabled={!canSave}>
          {save.isPending ? "Saving…" : "Save settings"}
        </Button>
        </div>
        </fieldset>
      </form>
      {solo && role === "admin" ? (
        <section className="mt-10 grid gap-3 panel p-4">
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
    </WorkPage>
  );
}
