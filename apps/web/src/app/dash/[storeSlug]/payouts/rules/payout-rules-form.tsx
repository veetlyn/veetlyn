"use client";

import { nativeSelectClass } from "@jendal-workspace/ui/lib/native-select";
import {
  type Currency,
  PAYDAYS,
  type Payday,
  PAYOUT_RULE_SCOPES,
  type PayoutRuleScope,
  presetRules,
} from "@jendal-workspace/core";
import { Button } from "@jendal-workspace/ui/components/button";
import { Checkbox } from "@jendal-workspace/ui/components/checkbox";
import { Input } from "@jendal-workspace/ui/components/input";
import { Label } from "@jendal-workspace/ui/components/label";
import { Check } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";

import type { AppRouter } from "@jendal-workspace/api/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import Loader from "@/components/loader";
import { PlatformName } from "@/components/platform-name";
import TeamNotFound from "@/components/services-team/team-not-found";
import { formatMinor } from "@/lib/money";
import {
  type AutoApproveMode,
  payoutRulesFormValues,
  payoutRulesInput,
  type PayoutRulesFormValues,
  type PayoutRulesInput,
} from "@/lib/payout-rules-form";
import { SERVICES_TEAM_ROLE_LABELS } from "@/lib/services-team-labels";
import { trpc } from "@/utils/trpc";

import { ConfirmDialog } from "../confirm-dialog";
import { inputRules, rulesSummary, type RulesSummary, type SendingMode, unattendedExpansions } from "./rules-summary";

type RulesView = inferRouterOutputs<AppRouter>["payouts"]["rules"];
type TeamMember = inferRouterOutputs<AppRouter>["servicesTeam"]["listMembers"][number];

const FIXED_PRESETS = ["manual", "rules", "automatic"] as const;
type FixedPreset = (typeof FIXED_PRESETS)[number];

const SELECT_CLASS = `${nativeSelectClass}`;
const CHOICE_CLASS = "flex items-center gap-2 text-sm";

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

function Group({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-4 panel p-4">
      <legend className="px-1 font-medium">{legend}</legend>
      {children}
    </fieldset>
  );
}

function RadioGroup<T extends string>({
  name,
  legend,
  options,
  labels,
  value,
  onChange,
}: {
  name: string;
  legend: string;
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((option) => (
          <label key={option} className={CHOICE_CLASS}>
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="accent-current"
            />
            {labels[option]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  hint,
  inputMode = "decimal",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  inputMode?: "decimal" | "numeric";
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={inputMode}
        className="w-40"
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint ? (
        <div id={`${id}-hint`} className="space-y-1 text-sm text-muted-foreground">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function SummaryList({ heading, lines }: { heading: string; lines: string[] }) {
  return (
    <div className="space-y-1">
      <dt className="text-sm font-medium">{heading}</dt>
      {lines.map((line) => (
        <dd key={line} className="text-sm text-muted-foreground">
          {line}
        </dd>
      ))}
    </div>
  );
}

// Leads the page: the consequences of the rules as they stand in the form, saved or not.
function EffectiveRules({ summary, dirty }: { summary: RulesSummary; dirty: boolean }) {
  return (
    <section aria-labelledby="effective-heading" className="space-y-3 panel p-4">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 id="effective-heading" className="font-medium">
          {dirty ? "After you save" : "What happens now"}
        </h2>
        {dirty ? (
          <span className="text-sm text-muted-foreground">Unsaved changes. Nothing changes until you save.</span>
        ) : null}
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        <SummaryList heading="Who approves" lines={summary.approval} />
        <SummaryList heading="Completed projects" lines={summary.automatic} />
        <SummaryList heading="When it is sent" lines={summary.sending} />
        <SummaryList heading="Limits" lines={summary.limits} />
      </dl>
      <p className="text-xs text-muted-foreground">
        A change applies to payouts decided after you save. Approved payouts waiting for a payday move to the new one.
      </p>
    </section>
  );
}

function PresetPicker({
  teamSlug,
  rules,
  dirty,
  sending,
  nameOf,
  onSaved,
}: {
  teamSlug: string;
  rules: RulesView;
  dirty: boolean;
  sending: SendingMode;
  nameOf: (id: string) => string | undefined;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  // The preset waiting for confirmation: picking one saves it, so its effect is shown first.
  const [pending, setPending] = useState<FixedPreset | null>(null);
  const apply = useMutation(
    trpc.payouts.applyRulesPreset.mutationOptions({
      onSuccess: (data) => {
        queryClient.setQueryData(trpc.payouts.rules.queryKey({ teamSlug }), data);
        onSaved();
        toast.success("Payout rules saved.");
      },
    }),
  );

  function confirmBody(preset: FixedPreset): string {
    const values = payoutRulesFormValues({
      ...presetRules(preset),
      trustedMemberIds: rules.trustedMemberIds,
    });
    const summary = rulesSummary(values, {
      currency: rules.currency,
      sending,
      nameOf,
    });
    return [
      ...summary.approval,
      ...summary.automatic,
      ...summary.sending,
      "This replaces the rules below and saves now. Trusted members stay.",
      dirty ? "Your unsaved changes below are discarded." : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  // Arrow keys move focus between presets without choosing one, since choosing saves.
  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]");
    buttons?.[(index + step + FIXED_PRESETS.length) % FIXED_PRESETS.length]?.focus();
  }

  return (
    <section aria-labelledby="presets-heading" className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 id="presets-heading" className="font-medium">
          Presets
        </h2>
        {rules.preset === "custom" ? <span className="text-xs text-muted-foreground">Custom rules in use</span> : null}
      </div>
      <p id="presets-note" className="text-sm text-muted-foreground">
        Choosing a preset shows what it does, then saves it once you confirm.
      </p>
      <div
        ref={groupRef}
        role="radiogroup"
        aria-labelledby="presets-heading"
        aria-describedby="presets-note"
        className="grid gap-2 sm:grid-cols-3"
      >
        {FIXED_PRESETS.map((preset, index) => {
          const selected = rules.preset === preset;
          return (
            <button
              key={preset}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={apply.isPending}
              onKeyDown={(event) => moveFocus(event, index)}
              onClick={() => {
                if (selected) return;
                apply.reset();
                setPending(preset);
                dialogRef.current?.showModal();
              }}
              className="panel p-3 text-left text-sm disabled:opacity-50 aria-checked:border-foreground aria-checked:bg-accent"
            >
              <span className="flex items-center justify-between gap-2 font-medium">
                {PRESET_LABELS[preset]}
                {selected ? (
                  <span className="inline-flex items-center gap-1 text-xs">
                    <Check aria-hidden className="size-3.5" />
                    Selected
                  </span>
                ) : null}
              </span>
              <span className="block text-muted-foreground">{presetDescription(preset, rules.currency)}</span>
            </button>
          );
        })}
      </div>
      {apply.error ? (
        <p role="alert" className="text-sm text-destructive">
          {apply.error.message}
        </p>
      ) : null}
      <ConfirmDialog
        dialogRef={dialogRef}
        id="preset-confirm"
        title={pending ? `Switch to ${PRESET_LABELS[pending]}?` : "Switch preset?"}
        body={pending ? confirmBody(pending) : ""}
        confirmLabel={pending ? `Save ${PRESET_LABELS[pending]}` : "Save"}
        onConfirm={() => {
          if (pending) apply.mutate({ teamSlug, preset: pending });
        }}
      />
    </section>
  );
}

function TrustedMembers({
  members,
  savedIds,
  viewerId,
  values,
  patch,
}: {
  members: TeamMember[];
  savedIds: readonly string[];
  viewerId: string;
  values: PayoutRulesFormValues;
  patch: (change: Partial<PayoutRulesFormValues>) => void;
}) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Trusted members</legend>
      <p className="text-sm text-muted-foreground">Payouts to these members are approved without an admin.</p>
      <ul className="space-y-2">
        {members.map((member) => {
          // The server refuses an admin adding themselves; one already added by another admin may still leave.
          const self = member.userId === viewerId && !savedIds.includes(viewerId);
          const checked = values.trustedMemberIds.includes(member.userId);
          return (
            <li key={member.userId}>
              <label className={CHOICE_CLASS}>
                <Checkbox
                  checked={checked}
                  disabled={self}
                  aria-describedby={self ? "trusted-self-note" : undefined}
                  onCheckedChange={(next) =>
                    patch({
                      trustedMemberIds:
                        next === true
                          ? [...values.trustedMemberIds, member.userId]
                          : values.trustedMemberIds.filter((id) => id !== member.userId),
                    })
                  }
                />
                <span>
                  {member.name}{" "}
                  <span className="text-muted-foreground">({SERVICES_TEAM_ROLE_LABELS[member.role]})</span>
                </span>
              </label>
              {self ? (
                <p id="trusted-self-note" className="ml-6 text-sm text-muted-foreground">
                  Another admin has to add you.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <RadioGroup
        name="trusted-scope"
        legend="Applies to"
        options={PAYOUT_RULE_SCOPES}
        labels={SCOPE_LABELS}
        value={values.trustedScope}
        onChange={(trustedScope) => patch({ trustedScope })}
      />
    </fieldset>
  );
}

function RulesForm({
  teamSlug,
  viewerId,
  rules,
  members,
  balanceReadable,
  sending,
  onSaved,
}: {
  teamSlug: string;
  viewerId: string;
  rules: RulesView;
  members: TeamMember[];
  balanceReadable: "yes" | "reconnect" | "off";
  sending: SendingMode;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [initial] = useState(() => payoutRulesFormValues(rules));
  const [values, setValues] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const confirmRef = useRef<HTMLDialogElement>(null);
  // Changes that let more money move without an admin, held until the admin confirms them.
  const [expansions, setExpansions] = useState<{
    changes: string[];
    input: PayoutRulesInput;
  } | null>(null);
  const nameOf = (id: string) => members.find((member) => member.userId === id)?.name;
  const summary = rulesSummary(values, {
    currency: rules.currency,
    sending,
    nameOf,
  });
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
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
    const changes = unattendedExpansions(rules, inputRules(result.input), currency);
    if (changes.length > 0) {
      setExpansions({ changes, input: result.input });
      confirmRef.current?.showModal();
      return;
    }
    save.mutate({ teamSlug, ...result.input });
  }

  const error = problem ?? save.error?.message ?? null;

  return (
    <div className="space-y-8">
      <EffectiveRules summary={summary} dirty={dirty} />
      <PresetPicker
        teamSlug={teamSlug}
        rules={rules}
        dirty={dirty}
        sending={sending}
        nameOf={nameOf}
        onSaved={onSaved}
      />
      {/* Progressive reveal: a preset needs no per-rule fields; custom rules or unsaved edits keep them open. */}
      <details open={rules.preset === "custom" || dirty || undefined} className="space-y-6">
        <summary className="cursor-pointer font-medium">
          Adjust each rule
          <span className="text-sm font-normal text-muted-foreground"> · approval, sending and limits</span>
        </summary>
        <form onSubmit={handleSubmit} className="mt-6 grid gap-6">
          <Group legend="Approval">
            <p className="text-sm text-muted-foreground">
              Approval decides whether a payout may go. Sending, further down, decides when it goes.
            </p>
            <RadioGroup
              name="auto-approve"
              legend="Auto-approve"
              options={["off", "up_to", "any"] as const}
              labels={AUTO_APPROVE_LABELS}
              value={values.autoApprove}
              onChange={(autoApprove) => patch({ autoApprove })}
            />
            {values.autoApprove === "up_to" ? (
              <TextField
                id="auto-approve-up-to"
                label={`Auto-approve payouts up to (${currency})`}
                value={values.autoApproveUpTo}
                onChange={(autoApproveUpTo) => patch({ autoApproveUpTo })}
              />
            ) : null}
            {values.autoApprove !== "off" ? (
              <RadioGroup
                name="auto-approve-scope"
                legend="Auto-approve applies to"
                options={PAYOUT_RULE_SCOPES}
                labels={SCOPE_LABELS}
                value={values.autoApproveScope}
                onChange={(autoApproveScope) => patch({ autoApproveScope })}
              />
            ) : null}
            <TrustedMembers
              members={members}
              savedIds={rules.trustedMemberIds}
              viewerId={viewerId}
              values={values}
              patch={patch}
            />
            <TextField
              id="second-approver-above"
              label={`Require a second admin above (${currency})`}
              value={values.secondApproverAbove}
              onChange={(secondApproverAbove) => patch({ secondApproverAbove })}
              hint={
                <p>
                  {rules.adminCount < 2
                    ? "Add a second admin before requiring two approvals."
                    : "Leave it empty to need one admin."}
                </p>
              }
            />
            {values.secondApproverAbove.trim() !== "" ? (
              <RadioGroup
                name="second-approver-scope"
                legend="Second admin applies to"
                options={PAYOUT_RULE_SCOPES}
                labels={SCOPE_LABELS}
                value={values.secondApproverScope}
                onChange={(secondApproverScope) => patch({ secondApproverScope })}
              />
            ) : null}
          </Group>

          <Group legend="Automatic payouts">
            <label className={CHOICE_CLASS}>
              <Checkbox
                checked={values.payCompletedProjects}
                onCheckedChange={(checked) => patch({ payCompletedProjects: checked === true })}
              />
              Pay each completed project automatically
            </label>
            {values.payCompletedProjects && rules.payCompletedProjectsSince ? (
              <p className="text-sm text-muted-foreground">
                Pays projects completed since{" "}
                {new Date(rules.payCompletedProjectsSince).toLocaleDateString(undefined, { dateStyle: "long" })}.
              </p>
            ) : null}
            {/* The wait only delays automatic project payouts; hidden, its saved value still goes back unchanged. */}
            {values.payCompletedProjects ? (
              <TextField
                id="hold-days"
                label="Days to wait after a project completes"
                value={values.holdDays}
                onChange={(holdDays) => patch({ holdDays })}
                inputMode="numeric"
                hint={<p>From 0 to 90. Members can still ask for their earnings during this time.</p>}
              />
            ) : null}
          </Group>

          <Group legend="Sending">
            <RadioGroup
              name="payday"
              legend="Payday"
              options={PAYDAYS}
              labels={PAYDAY_LABELS}
              value={values.payday}
              onChange={(payday) => patch({ payday })}
            />
            {values.payday === "weekly" ? (
              <div className="space-y-2">
                <Label htmlFor="payday-weekday">Day of the week</Label>
                <select
                  id="payday-weekday"
                  className={SELECT_CLASS}
                  value={values.paydayWeekday}
                  onChange={(e) => patch({ paydayWeekday: e.target.value })}
                >
                  {WEEKDAYS.map((day, index) => (
                    <option key={day} value={index}>
                      {day}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {values.payday === "monthly" ? (
              <div className="space-y-2">
                <Label htmlFor="payday-month-day">Day of the month</Label>
                <select
                  id="payday-month-day"
                  className={SELECT_CLASS}
                  value={values.paydayMonthDay}
                  onChange={(e) => patch({ paydayMonthDay: e.target.value })}
                >
                  {MONTH_DAYS.map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {values.payday !== "immediate" ? (
              <p className="text-sm text-muted-foreground">Payday starts at 00:00 UTC.</p>
            ) : null}
            <TextField
              id="balance-floor"
              label={`Keep at least this in the team's PayPal balance (${currency})`}
              value={values.balanceFloor}
              onChange={(balanceFloor) => patch({ balanceFloor })}
              hint={
                <>
                  <p>
                    <PlatformName /> reads your PayPal balance to apply this.
                  </p>
                  {balanceReadable === "reconnect" ? (
                    <p>
                      Turn on automatic payouts again so <PlatformName /> can read your balance.
                    </p>
                  ) : balanceReadable === "off" ? (
                    <p>
                      Turn on automatic payouts so <PlatformName /> can read your balance.
                    </p>
                  ) : null}
                </>
              }
            />
          </Group>

          <Group legend="Limits">
            <TextField
              id="minimum-payout"
              label={`Minimum payout (${currency})`}
              value={values.minimumPayout}
              onChange={(minimumPayout) => patch({ minimumPayout })}
            />
          </Group>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={save.isPending} className="justify-self-start">
            {save.isPending ? "Saving…" : "Save rules"}
          </Button>
        </form>
      </details>
      <ConfirmDialog
        dialogRef={confirmRef}
        id="rules-expand-confirm"
        title="Let more payouts go without an admin?"
        body={`${expansions?.changes.join(" ") ?? ""} This applies to payouts decided after you save.`}
        confirmLabel="Save rules"
        onConfirm={() => {
          if (expansions) save.mutate({ teamSlug, ...expansions.input });
        }}
      />
    </div>
  );
}

function RulesEditor({ teamSlug, viewerId }: { teamSlug: string; viewerId: string }) {
  // Bumped after each save so the form reloads the saved rules, while a background refetch keeps unsaved edits.
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((current) => current + 1);
  const rules = useQuery({
    ...trpc.payouts.rules.queryOptions({ teamSlug }),
    retry: false,
    meta: { silent: true },
  });
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
  // Approved payouts are only sent by the platform when automatic payouts (PayPal credentials) are on.
  const sending: SendingMode = credentials.isSuccess ? (credentials.data == null ? "export" : "automatic") : "unknown";

  return (
    <RulesForm
      key={version}
      teamSlug={teamSlug}
      viewerId={viewerId}
      rules={rules.data}
      members={members.data}
      balanceReadable={balanceReadable}
      sending={sending}
      onSaved={reload}
    />
  );
}

export default function PayoutRules({ teamSlug, viewerId }: { teamSlug: string; viewerId: string }) {
  const result = useQuery({
    ...trpc.servicesTeam.get.queryOptions({ teamSlug }),
    retry: false,
    meta: { silent: true },
  });

  if (result.isPending) return <Loader />;
  if (result.isError) return <TeamNotFound />;

  const { team, role, settings } = result.data;

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-6 md:px-7 md:py-8">
      <div className="space-y-1">
        <h1 className="font-heading text-3xl">Payout rules</h1>
        <p className="text-sm text-muted-foreground">How this team approves and sends its members' payouts.</p>
      </div>
      {settings?.solo ? (
        <p className="text-sm text-muted-foreground">
          Payouts are for teams. As a solo seller, clients pay you directly in your PayPal account.
        </p>
      ) : role !== "admin" ? (
        <p className="text-sm text-muted-foreground">Only an admin can change the team settings.</p>
      ) : (
        <RulesEditor teamSlug={team.slug} viewerId={viewerId} />
      )}
    </main>
  );
}
