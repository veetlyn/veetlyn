"use client";

import {
  type Currency,
  PAYDAYS,
  type Payday,
  PAYOUT_RULE_SCOPES,
  type PayoutRuleScope,
  presetRules,
} from "@jendal-workspace/core";
import { Badge } from "@jendal-workspace/ui/components/badge";
import { CARD_TARGET_CLASS, Card, CardDescription, CardHeader, CardTitle } from "@jendal-workspace/ui/components/motion/card";
import { Checkbox } from "@jendal-workspace/ui/components/motion/checkbox";
import { RadioGroup, RadioGroupItem } from "@jendal-workspace/ui/components/motion/radio";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@jendal-workspace/ui/components/motion/select";
import { Switch } from "@jendal-workspace/ui/components/motion/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import Loader from "@/components/loader";
import { PageHeader, WorkPage } from "@/components/page-composition";
import { SaveBar, SettingsField, SettingsSection } from "@/components/settings-section";
import { ValueInput } from "@/components/value-input";
import { PlatformName } from "@/components/platform-name";
import TeamNotFound from "@/components/services-team/team-not-found";
import { formatMinor } from "@/lib/money";
import {
  type AutoApproveMode,
  payoutRulesFormValues,
  payoutRulesInput,
  type PayoutRulesFormValues,
} from "@/lib/payout-rules-form";
import { SERVICES_TEAM_ROLE_LABELS } from "@/lib/services-team-labels";
import { trpc } from "@/utils/trpc";

type RulesView = inferRouterOutputs<AppRouter>["payouts"]["rules"];
type TeamMember = inferRouterOutputs<AppRouter>["servicesTeam"]["listMembers"][number];

const FIXED_PRESETS = ["manual", "rules", "automatic"] as const;
type FixedPreset = (typeof FIXED_PRESETS)[number];


const SCOPE_LABELS = {
  requests: "Member requests",
  automatic: "Automatic payouts",
  both: "Both",
} satisfies Record<PayoutRuleScope, string>;

const PAYDAY_LABELS = {
  immediate: "Right away",
  weekly: "Once a week",
  monthly: "Once a month",
} satisfies Record<Payday, string>;

const AUTO_APPROVE_LABELS = {
  off: "Off",
  up_to: "Up to an amount",
  any: "Any amount",
} satisfies Record<AutoApproveMode, string>;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_DAYS = Array.from({ length: 28 }, (_, index) => index + 1);

const PRESET_LABELS = {
  manual: "Manual",
  rules: "Rules",
  automatic: "Automatic",
} satisfies Record<FixedPreset, string>;

function presetDescription(preset: FixedPreset, currency: Currency): string {
  switch (preset) {
    case "manual":
      return "An admin approves every payout.";
    case "rules":
      return `Requests up to ${formatMinor(presetRules("rules").autoApproveUpToMinor ?? 0, currency)} are approved on their own.`;
    case "automatic":
      return "Each completed project pays out on its own.";
  }
}

// A choice among a few options, laid out in a row on the right of its setting.
function Choice<T extends string>({ label, description, options, labels, value, onChange }: {
  label: string;
  description?: ReactNode;
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <SettingsField label={label} description={description}>
      <RadioGroup
        aria-label={label}
        orientation="horizontal"
        value={value}
        onValueChange={(next) => { const option = options.find((o) => o === next); if (option) onChange(option); }}
        className="gap-x-5 gap-y-2 [&_label_span]:text-[14px]"
      >
        {options.map((option) => <RadioGroupItem key={option} value={option} label={labels[option]} />)}
      </RadioGroup>
    </SettingsField>
  );
}

function AmountField({ id, label, description, value, onChange, unit, numeric = false }: {
  id: string;
  label: string;
  description?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  unit: string;
  numeric?: boolean;
}) {
  return (
    <SettingsField id={id} label={label} description={description}>
      <ValueInput
        id={id}
        unit={unit}
        type={numeric ? "number" : "text"}
        min={numeric ? 0 : undefined}
        max={id === "hold-days" ? 90 : undefined}
        step={numeric ? 1 : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={numeric ? "numeric" : "decimal"}
      />
    </SettingsField>
  );
}

// The three starting points, as cards to pick from. Picking one saves it at once.
function PresetPicker({ teamSlug, rules, onSaved }: { teamSlug: string; rules: RulesView; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const apply = useMutation(
    trpc.payouts.applyRulesPreset.mutationOptions({
      onSuccess: (data) => {
        queryClient.setQueryData(trpc.payouts.rules.queryKey({ teamSlug }), data);
        onSaved();
        toast.success("Payout rules saved.");
      },
    }),
  );

  return (
    <SettingsSection
      title="Start from a preset"
      description={<>A preset replaces the rules below; trusted members stay.{rules.preset === "custom" ? <> Your rules are <Badge tone="neutral" className="ml-0.5">Custom</Badge></> : null}</>}
    >
      <div className="grid gap-3 p-5 sm:grid-cols-3">
        {FIXED_PRESETS.map((preset) => {
          const selected = rules.preset === preset;
          return (
            <Card key={preset} size="compact" interactive selected={selected} className="rounded-[12px] bg-card shadow-none data-selected:border-foreground data-selected:shadow-[0_0_0_1px_var(--foreground)]">
              <CardHeader className="gap-1">
                <CardTitle className="text-[14px] font-medium">
                  <button
                    type="button"
                    aria-pressed={selected}
                    disabled={apply.isPending}
                    onClick={() => { apply.reset(); apply.mutate({ teamSlug, preset }); }}
                    className={`${CARD_TARGET_CLASS} text-left outline-none`}
                  >
                    {PRESET_LABELS[preset]}
                  </button>
                </CardTitle>
                <CardDescription className="text-[13px] leading-5">{presetDescription(preset, rules.currency)}</CardDescription>
              </CardHeader>
            </Card>
          );
        })}
      </div>
      {apply.error ? <p role="alert" className="px-6 py-4 text-[13px] text-destructive">{apply.error.message}</p> : null}
    </SettingsSection>
  );
}

function TrustedMembers({ members, savedIds, viewerId, values, patch }: {
  members: TeamMember[];
  savedIds: readonly string[];
  viewerId: string;
  values: PayoutRulesFormValues;
  patch: (change: Partial<PayoutRulesFormValues>) => void;
}) {
  return (
    <>
      <SettingsField label="Trusted members" description="Payouts to these members are approved without an admin." wide>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {members.map((member) => {
            // The server refuses an admin adding themselves; one already added by another admin may still leave.
            const self = member.userId === viewerId && !savedIds.includes(viewerId);
            const checked = values.trustedMemberIds.includes(member.userId);
            return (
              <Checkbox
                key={member.userId}
                checked={checked}
                disabled={self}
                label={member.name}
                description={self ? "Another admin has to add you." : SERVICES_TEAM_ROLE_LABELS[member.role]}
                onCheckedChange={(next) => patch({
                  trustedMemberIds: next ? [...values.trustedMemberIds, member.userId] : values.trustedMemberIds.filter((id) => id !== member.userId),
                })}
              />
            );
          })}
        </div>
      </SettingsField>
      <Choice label="Trust applies to" options={PAYOUT_RULE_SCOPES} labels={SCOPE_LABELS} value={values.trustedScope} onChange={(trustedScope) => patch({ trustedScope })} />
    </>
  );
}

function RulesForm({ teamSlug, viewerId, rules, members, balanceReadable, onSaved }: {
  teamSlug: string;
  viewerId: string;
  rules: RulesView;
  members: TeamMember[];
  balanceReadable: "yes" | "reconnect" | "off";
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const initial = payoutRulesFormValues(rules);
  const [values, setValues] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation(
    trpc.payouts.saveRules.mutationOptions({
      onSuccess: (data) => {
        queryClient.setQueryData(trpc.payouts.rules.queryKey({ teamSlug }), data);
        onSaved();
        toast.success("Payout rules saved.");
      },
    }),
  );
  const { currency } = rules;
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);

  function patch(change: Partial<PayoutRulesFormValues>) {
    setValues((current) => ({ ...current, ...change }));
    setProblem(null);
    save.reset();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = payoutRulesInput(values);
    if ("problem" in result) {
      setProblem(result.problem);
      return;
    }
    save.mutate({ teamSlug, ...result.input });
  }

  const balanceHint = (
    <>
      <PlatformName /> reads your PayPal balance to apply this.
      {balanceReadable === "reconnect" ? <> Turn on automatic payouts again so <PlatformName /> can read it.</> : balanceReadable === "off" ? <> Turn on automatic payouts so <PlatformName /> can read it.</> : null}
    </>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <SettingsSection title="Approval" description="Who approves a payout before it is sent.">
        <Choice label="Auto-approve" options={["off", "up_to", "any"] as const} labels={AUTO_APPROVE_LABELS} value={values.autoApprove} onChange={(autoApprove) => patch({ autoApprove })} />
        {values.autoApprove === "up_to" ? (
          <AmountField id="auto-approve-up-to" label="Auto-approve payouts up to" unit={currency} value={values.autoApproveUpTo} onChange={(autoApproveUpTo) => patch({ autoApproveUpTo })} />
        ) : null}
        {values.autoApprove !== "off" ? (
          <Choice label="Auto-approve applies to" options={PAYOUT_RULE_SCOPES} labels={SCOPE_LABELS} value={values.autoApproveScope} onChange={(autoApproveScope) => patch({ autoApproveScope })} />
        ) : null}
        <TrustedMembers members={members} savedIds={rules.trustedMemberIds} viewerId={viewerId} values={values} patch={patch} />
        <AmountField
          id="second-approver-above"
          label="Require a second admin above"
          description={rules.adminCount < 2 ? "Add a second admin before requiring two approvals." : "Leave it empty to need one admin."}
          unit={currency}
          value={values.secondApproverAbove}
          onChange={(secondApproverAbove) => patch({ secondApproverAbove })}
        />
        {values.secondApproverAbove.trim() !== "" ? (
          <Choice label="Second admin applies to" options={PAYOUT_RULE_SCOPES} labels={SCOPE_LABELS} value={values.secondApproverScope} onChange={(secondApproverScope) => patch({ secondApproverScope })} />
        ) : null}
      </SettingsSection>

      <SettingsSection title="Automatic payouts" description="Pay members when their projects complete, without a request.">
        <SettingsField
          label="Pay each completed project"
          description={values.payCompletedProjects && rules.payCompletedProjectsSince
            ? `Pays projects completed since ${new Date(rules.payCompletedProjectsSince).toLocaleDateString(undefined, { dateStyle: "medium" })}.`
            : "Members are paid their share once a project completes."}
        >
          <Switch checked={values.payCompletedProjects} onCheckedChange={(payCompletedProjects) => patch({ payCompletedProjects })} ariaLabel="Pay each completed project automatically" />
        </SettingsField>
        <AmountField
          id="hold-days"
          label="Days to wait after a project completes"
          description="From 0 to 90. Members can still ask for their earnings meanwhile."
          unit="days"
          numeric
          value={values.holdDays}
          onChange={(holdDays) => patch({ holdDays })}
        />
      </SettingsSection>

      <SettingsSection title="Sending" description="When approved payouts leave the team's PayPal account.">
        <Choice
          label="Payday"
          description={values.payday !== "immediate" ? "Payday starts at 00:00 UTC." : undefined}
          options={PAYDAYS}
          labels={PAYDAY_LABELS}
          value={values.payday}
          onChange={(payday) => patch({ payday })}
        />
        {values.payday === "weekly" ? (
          <SettingsField label="Day of the week">
            <Select value={values.paydayWeekday} onValueChange={(paydayWeekday) => patch({ paydayWeekday })} className="z-30 w-44">
              <SelectTrigger aria-label="Day of the week" className="h-9 text-[14px]"><SelectValue /></SelectTrigger>
              <SelectContent>{WEEKDAYS.map((day, index) => <SelectItem key={day} value={String(index)}>{day}</SelectItem>)}</SelectContent>
            </Select>
          </SettingsField>
        ) : null}
        {values.payday === "monthly" ? (
          <SettingsField label="Day of the month">
            <Select value={values.paydayMonthDay} onValueChange={(paydayMonthDay) => patch({ paydayMonthDay })} className="z-30 w-28">
              <SelectTrigger aria-label="Day of the month" className="h-9 text-[14px]"><SelectValue /></SelectTrigger>
              <SelectContent>{MONTH_DAYS.map((day) => <SelectItem key={day} value={String(day)}>{String(day)}</SelectItem>)}</SelectContent>
            </Select>
          </SettingsField>
        ) : null}
        <AmountField id="balance-floor" label="Keep in the PayPal balance" description={balanceHint} unit={currency} value={values.balanceFloor} onChange={(balanceFloor) => patch({ balanceFloor })} />
      </SettingsSection>

      <SettingsSection title="Limits">
        <AmountField id="minimum-payout" label="Minimum payout" description="Smaller requests are refused, and smaller completed projects are not paid out automatically." unit={currency} value={values.minimumPayout} onChange={(minimumPayout) => patch({ minimumPayout })} />
      </SettingsSection>

      <SaveBar
        dirty={dirty}
        saving={save.isPending}
        canSave={dirty && !save.isPending}
        onDiscard={() => { setValues(initial); setProblem(null); save.reset(); }}
        error={problem ?? save.error?.message}
      />
    </form>
  );
}

function RulesEditor({ teamSlug, viewerId }: { teamSlug: string; viewerId: string }) {
  // Bumped after each save so the form reloads the saved rules, while a background refetch keeps unsaved edits.
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((current) => current + 1);
  const rules = useQuery({ ...trpc.payouts.rules.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const members = useQuery({
    ...trpc.servicesTeam.listMembers.queryOptions({ teamSlug }),
    retry: false,
    meta: { silent: true },
  });
  const credentials = useQuery({
    ...trpc.payouts.credentials.queryOptions({ teamSlug }),
    retry: false,
    meta: { silent: true },
  });

  if (rules.isPending || members.isPending) return <Loader />;
  const failed = rules.error ?? members.error;
  if (failed || !rules.data || !members.data) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {failed?.message ?? "Payout rules could not be loaded."}
      </p>
    );
  }

  const balanceReadable = credentials.data == null ? "off" : credentials.data.canReadBalance ? "yes" : "reconnect";

  return (
    <div className="space-y-6">
      <PresetPicker teamSlug={teamSlug} rules={rules.data} onSaved={reload} />
      <RulesForm
        key={version}
        teamSlug={teamSlug}
        viewerId={viewerId}
        rules={rules.data}
        members={members.data}
        balanceReadable={balanceReadable}
        onSaved={reload}
      />
    </div>
  );
}

export default function PayoutRules({ teamSlug, viewerId }: { teamSlug: string; viewerId: string }) {
  const result = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });

  if (result.isPending) return <Loader />;
  if (result.isError) return <TeamNotFound />;

  const { team, role, settings } = result.data;

  return (
    <WorkPage>
      <PageHeader title="Payout rules" description="How this team approves and sends its members' payouts." />
      {settings?.solo ? (
        <p className="text-[14px] text-muted-foreground">
          Payouts are for teams. As a solo seller, clients pay you directly in your PayPal account.
        </p>
      ) : role !== "admin" ? (
        <p className="text-[14px] text-muted-foreground">Only an admin can change the team settings.</p>
      ) : (
        <RulesEditor teamSlug={team.slug} viewerId={viewerId} />
      )}
    </WorkPage>
  );
}
