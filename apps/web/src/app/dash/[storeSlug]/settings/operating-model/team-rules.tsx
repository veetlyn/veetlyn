"use client";

import { RULE_SECTIONS, RulebookEditor, ruleAnchor } from "@opmodel/admin-rules/RulebookEditor";
import { RulebookSummaryView } from "@opmodel/admin-rules/RulebookSummaryView";
import type { RulebookSpec } from "@opmodel/engine-rules";
import { Button } from "@jendal-workspace/ui/components/button";
import { Badge } from "@jendal-workspace/ui/components/badge";
import { Checkbox } from "@jendal-workspace/ui/components/motion/checkbox";
import { Switch } from "@jendal-workspace/ui/components/motion/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import Loader from "@/components/loader";
import { PageHeader } from "@/components/page-composition";
import { type PageSection, PageSectionsRail } from "@/components/page-sections-nav";
import { FloatingBar, SettingsField, SettingsSection } from "@/components/settings-section";
import TeamNotFound from "@/components/services-team/team-not-found";
import { trpc } from "@/utils/trpc";

// What the assistant may do, as the server enforces it. Rows with a key are the team's to switch off.
const AGENT_LIMITS = [
  { what: "What it can see", how: "Only what the person asking can already open.", limit: "Same as that person", key: null },
  { what: "Quotes", how: "Drafted from the brief and your services.", limit: "Drafts, a person sends", key: "agentQuotes" },
  { what: "Client messages", how: "Questions and updates to clients.", limit: "Drafts, a person sends", key: "agentMessages" },
  { what: "Payouts", how: "It prepares approvals and rejections.", limit: "Prepares, a person decides", key: "agentPayouts" },
  { what: "Refunds and disputes", how: "Handled in the dashboard.", limit: "People only", key: null },
  { what: "Client payments", how: "Clients approve each payment themselves.", limit: "Never touches them", key: null },
] as const;

export default function TeamRules({ teamSlug }: { teamSlug: string }) {
  const queryClient = useQueryClient();
  const state = useQuery({ ...trpc.rules.state.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const team = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const [draft, setDraft] = useState<RulebookSpec | null>(null);
  const [acceptedId, setAcceptedId] = useState("");
  const [confirmingNotice, setConfirmingNotice] = useState(false);

  useEffect(() => setDraft(null), [state.data?.draft?.id, state.data?.draft?.version, state.data?.published.id, state.data?.published.version]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.rules.state.queryKey({ teamSlug }) });
  const setLimits = useMutation(
    trpc.agent.setLimits.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries({ queryKey: trpc.servicesTeam.get.queryKey({ teamSlug }) }),
    }),
  );
  const save = useMutation(trpc.rules.saveDraft.mutationOptions({ onSuccess: refresh }));
  const publish = useMutation(trpc.rules.publish.mutationOptions({ onSuccess: refresh }));
  const accept = useMutation(trpc.rules.acceptMember.mutationOptions({ onSuccess: refresh }));
  const notice = useMutation(trpc.rules.setNoticePreference.mutationOptions({ onSuccess: refresh }));
  const leaving = useMutation(trpc.rules.giveLeavingNotice.mutationOptions({ onSuccess: refresh }));

  if (state.isPending || team.isPending) return <Loader />;
  if (state.isError || team.isError) return <TeamNotFound />;

  const data = state.data;
  const published = data.published;
  const editable = draft ?? data.draft ?? published;
  const isAdmin = team.data.role === "admin";
  const acceptedCurrentVersion = data.memberAccepted === true;
  const selectedAcceptedVersion = acceptedId === published.id;
  const currency = team.data.settings?.currency ?? "USD";
  const draftError = save.error ?? publish.error;
  const memberError = accept.error ?? notice.error ?? leaving.error;
  const hasLeavingNotice = published.rules.leavingNotice.days > 0;
  const noticeEnd = data.leavingNoticeEffectiveAt;
  const sections: PageSection[] = [
    { id: "agent-limits", label: "What your agent can do" },
    ...(isAdmin
      ? [
          {
            id: "manage-rules",
            label: "Draft rules",
            children: [
              ...RULE_SECTIONS.map(({ ruleKey, title }) => ({ id: ruleAnchor(ruleKey), label: title })),
              ...(editable.rules.upfrontTiers.tiers.length > 0 ? [{ id: ruleAnchor("upfrontTiers"), label: "Upfront tiers" }] : []),
              { id: "draft-preview", label: "Preview" },
            ],
          },
        ]
      : []),
    { id: "published-rules", label: "Published agreement" },
    { id: "notice-preferences", label: "Project notices" },
    ...(hasLeavingNotice ? [{ id: "leaving-notice", label: "Leaving notice" }] : []),
  ];
  const canPublish = (Boolean(draft) || Boolean(data.draft)) && !save.isPending && !publish.isPending;

  async function publishDraft() {
    if (!isAdmin || (!draft && !data.draft)) return;
    try {
      if (draft) await save.mutateAsync({ teamSlug, preset: draft.preset, rules: draft.rules });
      await publish.mutateAsync({ teamSlug });
    } catch {
      return;
    }
  }

  const toggleLimit = (key: "agentQuotes" | "agentMessages" | "agentPayouts", checked: boolean) => {
    const settings = team.data.settings;
    if (!settings) return;
    setLimits.mutate({
      teamId: team.data.team.id,
      agentQuotes: settings.agentQuotes,
      agentMessages: settings.agentMessages,
      agentPayouts: settings.agentPayouts,
      [key]: checked,
    });
  };
  const draftPending = Boolean(draft) || Boolean(data.draft);

  return (
    <main className="mx-auto flex w-full max-w-[1104px] flex-col gap-8 px-4 py-6 md:px-7 md:py-8 lg:grid lg:grid-cols-[minmax(0,768px)_13rem] lg:justify-center lg:gap-10">
      <PageSectionsRail sections={sections} />
      <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
        <PageHeader
          title="Operating model"
          description={isAdmin
            ? "The team's rules, as a draft you publish. New projects take the published version."
            : "The agreement you work under in this team, and the terms clients accept with every new project."}
        />

        <div id="agent-limits" className="scroll-mt-4">
          <SettingsSection title="What your agent can do" description="The server holds the agent to these limits. Switch off what your team would rather do itself.">
            {AGENT_LIMITS.map(({ what, how, limit, key }) => {
              const on = key && team.data.settings ? team.data.settings[key] : true;
              return (
                <SettingsField key={what} label={what} description={how}>
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] text-muted-foreground">{on ? limit : "Off"}</span>
                    {key && isAdmin && team.data.settings ? (
                      <Switch checked={on} disabled={setLimits.isPending} ariaLabel={`Let the agent prepare: ${what}`} onCheckedChange={(checked) => toggleLimit(key, checked)} />
                    ) : null}
                  </div>
                </SettingsField>
              );
            })}
          </SettingsSection>
        </div>

        {isAdmin ? (
          <div id="manage-rules" className="scroll-mt-4">
            <SettingsSection title="Draft rules" description={`Published version ${published.version}. Edits stay in a draft until you publish them.`}>
              <fieldset disabled={save.isPending || publish.isPending} className="min-w-0 p-6">
                <legend className="sr-only">Draft rules</legend>
                <RulebookEditor spec={editable} currency={currency} onChange={setDraft} />
              </fieldset>
              <div id="draft-preview" className="scroll-mt-4 p-6">
                <RulebookSummaryView rules={editable.rules} currency={currency} version={data.draft?.version ?? published.version} />
              </div>
            </SettingsSection>
            {draftPending || draftError ? (
              <FloatingBar
                label="Draft rules"
                tone={draftError ? "error" : "muted"}
                message={draftError ? draftError.message : draft ? "You have unsaved edits to the rules." : `Draft version ${data.draft?.version ?? ""} is ready to publish.`}
              >
                <Button type="button" variant="ghost" size="sm" disabled={!draft || save.isPending || publish.isPending} onClick={() => draft && save.mutate({ teamSlug, preset: draft.preset, rules: draft.rules })}>
                  {save.isPending ? "Saving…" : "Save draft"}
                </Button>
                <Button type="button" size="sm" disabled={!canPublish} onClick={() => void publishDraft()}>
                  {publish.isPending ? "Publishing…" : "Publish new version"}
                </Button>
              </FloatingBar>
            ) : null}
          </div>
        ) : null}

        <div id="published-rules" className="scroll-mt-4">
          <SettingsSection
            title="Published agreement"
            description={`Version ${published.version}: what members and clients agree to.`}
            footer={acceptedCurrentVersion ? (
              <span className="flex items-center gap-2"><Badge tone="good">Accepted</Badge>You accepted this member agreement.</span>
            ) : (
              <>
                <Checkbox
                  checked={selectedAcceptedVersion}
                  onCheckedChange={(checked) => setAcceptedId(checked ? published.id : "")}
                  label={`I have read and accept version ${published.version}.`}
                  className="text-foreground"
                />
                <Button type="button" size="sm" disabled={!selectedAcceptedVersion || accept.isPending} onClick={() => accept.mutate({ teamSlug, termsAccepted: true, acceptedRulebookId: published.id })}>
                  {accept.isPending ? "Recording…" : "Accept member agreement"}
                </Button>
              </>
            )}
          >
            <div className="p-6">
              <RulebookSummaryView rules={published.rules} currency={currency} initialTab="member" tabs={["member", "client"]} />
            </div>
          </SettingsSection>
        </div>

        <div id="notice-preferences" className="scroll-mt-4">
          <SettingsSection title="Project notices" description="Emails about the projects you work on in this team.">
            <SettingsField label="Email me project notices" description="Updates when a project you are on moves forward.">
              <Switch
                checked={notice.isPending ? notice.variables.projectNoticesEnabled : state.data.projectNoticesEnabled}
                disabled={notice.isPending}
                ariaLabel="Email me project notices"
                onCheckedChange={(checked) => notice.mutate({ teamSlug, projectNoticesEnabled: checked })}
              />
            </SettingsField>
          </SettingsSection>
        </div>

        {hasLeavingNotice ? (
          <div id="leaving-notice" className="scroll-mt-4">
            <SettingsSection
              title="Leaving notice"
              description={`The agreement asks members to give ${published.rules.leavingNotice.days} days’ notice before leaving.`}
              footer={noticeEnd ? undefined : confirmingNotice ? (
                <>
                  <span className="text-foreground">You take no new requests from now on. Current projects continue.</span>
                  <span className="flex gap-2">
                    <Button type="button" variant="ghost" size="sm" disabled={leaving.isPending} onClick={() => setConfirmingNotice(false)}>Cancel</Button>
                    <Button type="button" variant="destructive" size="sm" disabled={leaving.isPending} onClick={() => leaving.mutate({ teamSlug })}>
                      {leaving.isPending ? "Recording…" : "Confirm leaving notice"}
                    </Button>
                  </span>
                </>
              ) : (
                <>
                  <span>This cannot be undone here.</span>
                  <Button type="button" variant="outline" size="sm" onClick={() => setConfirmingNotice(true)}>Give leaving notice</Button>
                </>
              )}
            >
              <p className="px-6 py-5 text-[14px]">
                {noticeEnd
                  ? `You gave notice. You take no new requests, and your notice ends on ${new Date(noticeEnd).toLocaleDateString()}.`
                  : "When you give notice, you stop taking new requests and finish the projects you have."}
              </p>
            </SettingsSection>
          </div>
        ) : null}

        {memberError ? <p role="alert" className="text-[13px] text-destructive">{memberError.message}</p> : null}
      </div>
    </main>
  );
}
