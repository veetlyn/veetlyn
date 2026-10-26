"use client";

import { RULE_SECTIONS, RulebookEditor, ruleAnchor } from "@opmodel/admin-rules/RulebookEditor";
import { RulebookSummaryView } from "@opmodel/admin-rules/RulebookSummaryView";
import type { RulebookSpec } from "@opmodel/engine-rules";
import { Button } from "@jendal-workspace/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import Loader from "@/components/loader";
import { type PageSection, PageSectionsRail } from "@/components/page-sections-nav";
import TeamNotFound from "@/components/services-team/team-not-found";
import { trpc } from "@/utils/trpc";

export default function TeamRules({ teamSlug }: { teamSlug: string }) {
  const queryClient = useQueryClient();
  const state = useQuery({ ...trpc.rules.state.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const team = useQuery({ ...trpc.servicesTeam.get.queryOptions({ teamSlug }), retry: false, meta: { silent: true } });
  const [draft, setDraft] = useState<RulebookSpec | null>(null);
  const [acceptedId, setAcceptedId] = useState("");
  const [effectiveAt, setEffectiveAt] = useState<string | null>(null);

  useEffect(() => setDraft(null), [state.data?.draft?.id, state.data?.draft?.version, state.data?.published.id, state.data?.published.version]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.rules.state.queryKey({ teamSlug }) });
  const save = useMutation(trpc.rules.saveDraft.mutationOptions({ onSuccess: refresh }));
  const publish = useMutation(trpc.rules.publish.mutationOptions({ onSuccess: refresh }));
  const accept = useMutation(trpc.rules.acceptMember.mutationOptions({ onSuccess: refresh }));
  const notice = useMutation(trpc.rules.setNoticePreference.mutationOptions({ onSuccess: refresh }));
  const leaving = useMutation(
    trpc.rules.giveLeavingNotice.mutationOptions({
      onSuccess: async (result) => {
        setEffectiveAt(result.effectiveAt);
        await refresh();
      },
    }),
  );

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
  const sections: PageSection[] = [
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

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 md:px-7 md:py-8">
      <header className="mb-6 space-y-2">
        <h1 className="font-heading text-3xl">Team rules</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Read the current agreement, see the rules attached to new projects, and manage a draft if you are an admin.
        </p>
      </header>

      <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_13rem] lg:gap-10">
        <PageSectionsRail sections={sections} />
        <div className="min-w-0 space-y-8 lg:col-start-1 lg:row-start-1">
          {isAdmin ? (
            <section id="manage-rules" className="scroll-mt-16 panel" aria-labelledby="manage-rules-heading">
              <div className="space-y-5 p-5">
                <div className="space-y-1">
                  <h2 id="manage-rules-heading" className="text-xl font-semibold">Draft rules</h2>
                  <p className="text-sm text-muted-foreground">
                    Published version {published.version}. Changes stay in a draft until an admin publishes them.
                  </p>
                </div>
                <fieldset disabled={save.isPending || publish.isPending} className="min-w-0">
                  <legend className="sr-only">Draft rules</legend>
                  <RulebookEditor spec={editable} currency={currency} onChange={setDraft} />
                </fieldset>
                <div id="draft-preview" className="scroll-mt-20">
                  <RulebookSummaryView rules={editable.rules} currency={currency} version={data.draft?.version ?? published.version} />
                </div>
              </div>
              <div className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-b-[inherit] border-t bg-card/95 px-5 py-3 backdrop-blur">
                <span className="mr-auto text-sm text-muted-foreground">
                  {draft ? "Unsaved edits." : data.draft ? `Draft version ${data.draft.version} is ready to publish.` : "Choose a preset or edit a rule to start a draft."}
                </span>
                {draftError ? <p role="alert" className="w-full text-sm text-destructive">{draftError.message}</p> : null}
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!draft || save.isPending || publish.isPending}
                  onClick={() => draft && save.mutate({ teamSlug, preset: draft.preset, rules: draft.rules })}
                >
                  {save.isPending ? "Saving…" : "Save draft"}
                </Button>
                <Button type="button" disabled={!canPublish} onClick={() => void publishDraft()}>
                  {publish.isPending ? "Publishing…" : "Publish new version"}
                </Button>
              </div>
            </section>
          ) : null}

          <section id="published-rules" className="scroll-mt-16 space-y-4 panel p-5" aria-labelledby="published-rules-heading">
            <div className="space-y-1">
              <h2 id="published-rules-heading" className="text-xl font-semibold">Published agreement</h2>
              <p className="text-sm text-muted-foreground">Version {published.version}</p>
            </div>
            <RulebookSummaryView rules={published.rules} currency={currency} version={published.version} initialTab="member" />
            {acceptedCurrentVersion ? (
              <p className="text-sm font-medium">You accepted this member agreement.</p>
            ) : (
              <div className="space-y-3 border-t pt-4">
                <label className="flex items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedAcceptedVersion}
                    onChange={(event) => setAcceptedId(event.target.checked ? published.id : "")}
                    className="mt-1 size-4 accent-current"
                  />
                  <span>I have read and accept the member agreement in version {published.version}.</span>
                </label>
                <Button
                  type="button"
                  disabled={!selectedAcceptedVersion || accept.isPending}
                  onClick={() => accept.mutate({ teamSlug, termsAccepted: true, acceptedRulebookId: published.id })}
                >
                  {accept.isPending ? "Recording…" : "Accept member agreement"}
                </Button>
              </div>
            )}
          </section>

          <section id="notice-preferences" className="scroll-mt-16 space-y-4 panel p-5" aria-labelledby="notice-preferences-heading">
            <div className="space-y-1">
              <h2 id="notice-preferences-heading" className="text-xl font-semibold">Project notices</h2>
              <p className="text-sm text-muted-foreground">Choose whether to receive project update emails for this team.</p>
            </div>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={state.data.projectNoticesEnabled}
                disabled={notice.isPending}
                onChange={(event) => notice.mutate({ teamSlug, projectNoticesEnabled: event.target.checked })}
                className="size-4 accent-current"
              />
              Email me project notices
            </label>
          </section>

          {hasLeavingNotice ? (
            <section id="leaving-notice" className="scroll-mt-16 space-y-3 panel p-5" aria-labelledby="leaving-notice-heading">
              <div className="space-y-1">
                <h2 id="leaving-notice-heading" className="text-xl font-semibold">Leaving notice</h2>
                <p className="text-sm text-muted-foreground">
                  The published agreement asks members to give {published.rules.leavingNotice.days} days’ notice before leaving.
                </p>
              </div>
              {effectiveAt ? <p className="text-sm">Your notice is recorded through {new Date(effectiveAt).toLocaleDateString()}.</p> : null}
              <Button type="button" variant="secondary" disabled={leaving.isPending || Boolean(effectiveAt)} onClick={() => leaving.mutate({ teamSlug })}>
                {leaving.isPending ? "Recording…" : "Give leaving notice"}
              </Button>
            </section>
          ) : null}

          {memberError ? <p role="alert" className="text-sm text-destructive">{memberError.message}</p> : null}
        </div>
      </div>
    </main>
  );
}
