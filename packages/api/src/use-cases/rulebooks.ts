import type { Database } from "@jendal-workspace/db";
import {
  ensurePublishedRulebook,
  findLeavingNoticeGivenAt,
  getDraftRulebook,
  getMemberNoticeEnabled,
  getPublishedRulebook,
  memberAcceptedRulebook,
  lockMemberWork,
  recordMemberMark,
  recordRulebookAcceptance,
  publishRulebook,
  saveRulebookDraft,
  setMemberNoticeEnabled,
  type RulebookRow,
} from "@jendal-workspace/db/repositories/operating-model";
import { runInTransaction } from "@jendal-workspace/db/repositories/unit-of-work";
import { rulebook } from "@jendal-workspace/db/schema/operating-model";
import { project } from "@jendal-workspace/db/schema/projects";
import { clientTermsLines, formatClientTermsSummary, formatCompactRuleSummary, formatMemberAgreementSummary, type RulebookRules } from "@opmodel/engine-rules";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// The team-facing rulebook state (AGT-46, AGT-47): what is published, what is drafted, whether the
// signed-in member accepted it, and the plain-English documents people read. Seeding v1 from the
// team's settings happens here, so every team has a rulebook the first time anyone looks.

export type TeamRulebookState = {
  published: { id: string; version: number; preset: RulebookRow["preset"]; rules: RulebookRules };
  draft: { id: string; version: number; preset: RulebookRow["preset"]; rules: RulebookRules } | null;
  memberAccepted: boolean | null;
  summaries: { clientTerms: string; memberAgreement: string; compact: string };
  projectNoticesEnabled: boolean;
  // The end of the notice the viewer gave, or null when they have not given any.
  leavingNoticeEffectiveAt: string | null;
};

export async function getTeamRulebookState(db: Database, input: { teamId: string; currency: string; userId?: string }): Promise<TeamRulebookState> {
  const published = await ensurePublishedRulebook(db, input.teamId);
  const draft = await getDraftRulebook(db, input.teamId);
  const memberAccepted =
    input.userId === undefined ? null : await memberAcceptedRulebook(db, { teamId: input.teamId, userId: input.userId, rulebookId: published.id });
  const projectNoticesEnabled = input.userId === undefined ? true : await getMemberNoticeEnabled(db, input.teamId, input.userId);
  const noticeGivenAt = input.userId === undefined ? null : await findLeavingNoticeGivenAt(db, { teamId: input.teamId, memberUserId: input.userId });
  return {
    published: { id: published.id, version: published.version, preset: published.preset, rules: published.spec },
    draft: draft ? { id: draft.id, version: draft.version, preset: draft.preset, rules: draft.spec } : null,
    memberAccepted,
    projectNoticesEnabled,
    leavingNoticeEffectiveAt: noticeGivenAt && leavingNoticeEnd(noticeGivenAt, published.spec.leavingNotice.days).toISOString(),
    summaries: {
      clientTerms: formatClientTermsSummary(published.spec, input.currency),
      memberAgreement: formatMemberAgreementSummary(published.spec, input.currency),
      compact: formatCompactRuleSummary(published.spec, input.currency),
    },
  };
}

// The plain-English terms a client reads before requesting (the seller page and the pay page).
export async function publishedClientTerms(
  db: Database,
  input: { teamId: string; currency: string },
): Promise<{ rulebookId: string; version: number; terms: string; termLines: string[]; compact: string }> {
  const rulebook = (await getPublishedRulebook(db, input.teamId)) ?? (await ensurePublishedRulebook(db, input.teamId));
  return {
    rulebookId: rulebook.id,
    version: rulebook.version,
    terms: formatClientTermsSummary(rulebook.spec, input.currency),
    termLines: clientTermsLines(rulebook.spec, input.currency),
    compact: formatCompactRuleSummary(rulebook.spec, input.currency),
  };
}

// The compact summary for a project's pinned rulebook; null when the project predates rulebooks.
export async function projectRuleSummary(db: Database, input: { projectId: string; currency: string }): Promise<string | null> {
  const [row] = await db
    .select({ spec: rulebook.spec })
    .from(project)
    .innerJoin(rulebook, eq(rulebook.id, project.rulebookId))
    .where(eq(project.id, input.projectId))
    .limit(1);
  return row ? formatCompactRuleSummary(row.spec, input.currency) : null;
}

// Members accept the latest published version at sign-in or from the rules page (AGT-47).
export async function acceptMemberRulebook(db: Database, input: { teamId: string; userId: string; termsAccepted: boolean; acceptedRulebookId: string }): Promise<{ version: number }> {
  if (input.termsAccepted !== true) throw new TRPCError({ code: "BAD_REQUEST", message: "Accept the member agreement before continuing." });
  return db.transaction(async (tx) => {
    await lockMemberWork(tx, { teamId: input.teamId, memberUserId: input.userId });
    const published = await ensurePublishedRulebook(tx, input.teamId);
    if (published.id !== input.acceptedRulebookId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "The member agreement has changed. Read and accept the current version." });
    }
    if (!(await memberAcceptedRulebook(tx, { teamId: input.teamId, userId: input.userId, rulebookId: published.id }))) {
      await recordRulebookAcceptance(tx, {
        rulebookId: published.id,
        teamId: input.teamId,
        actorKind: "member",
        userId: input.userId,
      });
    }
    return { version: published.version };
  });
}

export async function setMemberNoticePreference(
  db: Database,
  input: { teamId: string; userId: string; projectNoticesEnabled: boolean },
): Promise<void> {
  await setMemberNoticeEnabled(db, { teamId: input.teamId, userId: input.userId, enabled: input.projectNoticesEnabled });
}

// A member's leaving notice: recorded as a mark, its effective date from the pinned rulebook, and
// heard by the team's admins through the outbox. No new requests reach the member once it is in.
export async function giveMemberLeavingNotice(
  db: Database,
  input: { teamId: string; userId: string; rulebook: { leavingNotice: { days: number } }; now?: () => Date },
): Promise<{ effectiveAt: Date }> {
  const now = (input.now ?? (() => new Date()))();
  return db.transaction(async (locked) => {
    await lockMemberWork(locked, { teamId: input.teamId, memberUserId: input.userId });
    // Notice is given once: asking again returns the notice already running instead of restarting it.
    const givenAt = await findLeavingNoticeGivenAt(locked, { teamId: input.teamId, memberUserId: input.userId });
    if (givenAt) return { effectiveAt: leavingNoticeEnd(givenAt, input.rulebook.leavingNotice.days) };
    const effectiveAt = leavingNoticeEnd(now, input.rulebook.leavingNotice.days);
    return runInTransaction(locked, async (tx, uow) => {
    // The mark's time is the notice's start, so a later read gives the same end date.
    await recordMemberMark(tx, { teamId: input.teamId, memberUserId: input.userId, kind: "leaving_notice", createdAt: now });
    await uow.appendTeamOutbox(
      { teamId: input.teamId },
      [{ type: "member.leaving_notice", data: { memberUserId: input.userId, effectiveAt: effectiveAt.toISOString() } }],
    );
    return { effectiveAt };
    });
  });
}

function leavingNoticeEnd(givenAt: Date, days: number): Date {
  return new Date(givenAt.getTime() + days * 86_400_000);
}

export { ensurePublishedRulebook, publishRulebook, saveRulebookDraft };
