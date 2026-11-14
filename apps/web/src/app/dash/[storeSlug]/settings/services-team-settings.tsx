"use client";

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
import { RadioGroup, RadioGroupItem } from "@jendal-workspace/ui/components/motion/radio";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@jendal-workspace/ui/components/motion/select";
import { Textarea } from "@jendal-workspace/ui/components/textarea";
import { cn } from "@jendal-workspace/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { type FormEvent, useState } from "react";

import Loader from "@/components/loader";
import { PageHeader, WorkPage } from "@/components/page-composition";
import { SaveBar, SettingsField, SettingsSection } from "@/components/settings-section";
import { ValueInput } from "@/components/value-input";
import TeamNotFound from "@/components/services-team/team-not-found";
import { QUOTING_MODE_DESCRIPTIONS, QUOTING_MODE_LABELS } from "@/lib/services-team-labels";
import { rateField } from "@/lib/services-team-settings-form";
import { trpc } from "@/utils/trpc";

function RateField({ id, label, description, value, onChange }: {
  id: string;
  label: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const field = rateField(value);
  return (
    <SettingsField id={id} label={label} description={field.problem ? <span id={`${id}-problem`} className="text-destructive">{field.problem}</span> : description}>
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
    </SettingsField>
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
      onSuccess: () => {
        toast.success("Settings saved");
        setCurrency(null);
        setTeamCut(null);
        setManagementFee(null);
        setQuotingMode(null);
        return queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.get.queryKey({ teamSlug }) });
      },
    }),
  );
  const saveBio = useMutation(
    trpc.servicesTeam.updateBio.mutationOptions({
      onSuccess: (data) => {
        // The api stores the trimmed bio; sync the local state so the counter settles.
        setBio(data.bio);
        toast.success("Bio saved");
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

  // What the person has changed here, apart from defaults that were never saved.
  const edited = values.bio !== (current?.bio ?? "") || (current !== undefined && (values.currency !== current.currency || (!solo && (
    teamCutField.bps !== current.teamCutBps || managementFeeField.bps !== current.managementFeeBps || values.quotingMode !== current.quotingMode
  ))));
  const neverSaved = current?.settingsSavedAt == null;
  const discard = () => {
    setCurrency(null);
    setTeamCut(null);
    setManagementFee(null);
    setQuotingMode(null);
    setBio(null);
    save.reset();
    saveBio.reset();
  };
  const header = <PageHeader title="General" description="Your seller page, currency and the defaults for new work." />;

  if (role !== "admin") {
    return (
      <WorkPage>
        {header}
        <p className="text-[13px] text-muted-foreground">Only an admin can change these settings.</p>
        <SettingsSection title="Seller page" description="What clients read about you.">
          <SettingsField label="About you" wide>
            <p className="text-[14px] whitespace-pre-line">{values.bio.trim() ? values.bio : "No bio yet."}</p>
          </SettingsField>
        </SettingsSection>
        <SettingsSection title="Money and quoting">
          <SettingsField label="Currency" description="The default currency for new quotes."><p className="text-[14px]">{values.currency}</p></SettingsField>
          {!solo ? (
            <SettingsField label="Who can quote" description={QUOTING_MODE_DESCRIPTIONS[values.quotingMode]}><p className="text-[14px]">{QUOTING_MODE_LABELS[values.quotingMode]}</p></SettingsField>
          ) : null}
        </SettingsSection>
      </WorkPage>
    );
  }

  return (
    <WorkPage>
      {header}
      <form onSubmit={handleSubmit} className="space-y-6">
        <SettingsSection title="Seller page" description="What clients read about you before they ask for work.">
          <SettingsField id="bio" label="About you" description="What you make, for whom, and how you work." wide>
            <Textarea
              id="bio"
              value={values.bio}
              onChange={(e) => { setBio(e.target.value); saveBio.reset(); }}
              rows={4}
              maxLength={1_000}
              aria-describedby="bio-count"
              aria-invalid={bioTooLong || undefined}
              placeholder="Websites and brand refreshes for local shops…"
            />
            <p id="bio-count" className={cn("mt-2 text-right text-[12px] tabular-nums", bioTooLong ? "text-destructive" : "text-muted-foreground")}>
              {values.bio.trim().length} / {MAX_BIO_CHARS}
            </p>
          </SettingsField>
        </SettingsSection>

        <SettingsSection title="Money" description={solo ? "You work alone, so you keep the whole price." : "How a quoted price is split. Projects already quoted keep their terms."}>
          <SettingsField label="Currency" description="The default for new quotes. Existing projects keep theirs.">
            <Select value={values.currency} onValueChange={(next) => { if (isCurrency(next)) { setCurrency(next); save.reset(); } }} className="z-30 w-32">
              <SelectTrigger aria-label="Currency" className="h-9 text-[14px]"><SelectValue /></SelectTrigger>
              <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </SettingsField>
          {solo ? null : (
            <>
              <RateField id="team-cut" label="Team cut" description="Kept by the team from the quoted price." value={values.teamCut} onChange={(value) => { setTeamCut(value); save.reset(); }} />
              <RateField id="management-fee" label="Management fee" description="Added to the quoted price and paid by the client." value={values.managementFee} onChange={(value) => { setManagementFee(value); save.reset(); }} />
            </>
          )}
        </SettingsSection>

        {solo ? null : (
          <SettingsSection title="Who can quote" description="Who answers a new request with a price.">
            <RadioGroup
              aria-label="Who can quote"
              value={values.quotingMode}
              onValueChange={(next) => { if (isQuotingMode(next)) { setQuotingMode(next); save.reset(); } }}
              className="gap-0 divide-y"
            >
              {QUOTING_MODES.map((mode) => (
                <RadioGroupItem
                  key={mode}
                  value={mode}
                  label={QUOTING_MODE_LABELS[mode]}
                  description={QUOTING_MODE_DESCRIPTIONS[mode]}
                  className="w-full px-6 py-4 transition-colors duration-150 hover:bg-foreground/[0.02] [&_[id$=-label]]:text-[14px] [&_[id$=-label]]:leading-5 [&_[id$=-label]]:font-medium [&_[id$=-description]]:text-[13px] [&_[id$=-description]]:leading-5"
                />
              ))}
            </RadioGroup>
          </SettingsSection>
        )}

        <SaveBar
          dirty={edited || neverSaved}
          message={neverSaved && !edited ? "These defaults aren’t saved yet." : undefined}
          saving={save.isPending || saveBio.isPending}
          canSave={canSave}
          onDiscard={edited ? discard : undefined}
          error={save.error?.message ?? saveBio.error?.message}
        />
      </form>

      {solo ? (
        <SettingsSection
          title="Work as a team"
          description="Add members, split each price with a team cut and a management fee, and pay members out."
          footer={<>
            <span>Starts at a 15% team cut and a 10% management fee.</span>
            <Button type="button" variant="outline" size="sm" onClick={() => switchToTeam.mutate({ teamSlug })} disabled={switchToTeam.isPending}>
              {switchToTeam.isPending ? "Switching…" : "Switch to a team"}
            </Button>
          </>}
        >
          {switchToTeam.error ? <p role="alert" className="px-6 py-4 text-[13px] text-destructive">{switchToTeam.error.message}</p> : <p className="px-6 py-5 text-[13px] text-muted-foreground">You can add members after switching.</p>}
        </SettingsSection>
      ) : null}
    </WorkPage>
  );
}
