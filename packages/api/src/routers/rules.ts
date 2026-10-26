import {
  AGENCY_RULEBOOK_SPEC,
  COLLECTIVE_RULEBOOK_SPEC,
  RulebookRulesSchema,
  SOLO_RULEBOOK_SPEC,
  type RulebookSpec,
} from "@opmodel/engine-rules";
import { SOLO_TEAM_CUT_BPS } from "@jendal-workspace/core";
import { getServicesTeamSettings } from "@jendal-workspace/db/repositories/services-teams";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { router } from "../index";
import { requireAction, servicesTeamProcedure } from "../services-team-procedure";
import {
  acceptMemberRulebook,
  getTeamRulebookState,
  giveMemberLeavingNotice,
  publishRulebook,
  saveRulebookDraft,
  setMemberNoticePreference,
} from "../use-cases/rulebooks";

const PRESETS = {
  solo: SOLO_RULEBOOK_SPEC,
  agency: AGENCY_RULEBOOK_SPEC,
  collective: COLLECTIVE_RULEBOOK_SPEC,
} as const satisfies Record<string, RulebookSpec>;

const draftInput = z.object({
  preset: z.enum(["solo", "agency", "collective", "custom"]),
  rules: RulebookRulesSchema,
});

const SETTINGS_ADMINS_ONLY = "Only team admins manage the rules.";

// The rules page's API (AGT-46, AGT-47): the team's published and draft rulebooks with their
// plain-English documents, the member's acceptance and notice settings, and the actions around them.
export const rulesRouter = router({
  state: servicesTeamProcedure.query(async ({ ctx }) => {
    const settings = await getServicesTeamSettings(ctx.db, ctx.servicesTeam.id);
    return getTeamRulebookState(ctx.db, {
      teamId: ctx.servicesTeam.id,
      currency: settings?.currency ?? "USD",
      userId: ctx.session.user.id,
    });
  }),

  presets: servicesTeamProcedure.query(() => PRESETS),

  saveDraft: servicesTeamProcedure.input(draftInput).mutation(async ({ ctx, input }) => {
    requireAction(ctx.servicesTeamRole, "manage_settings", SETTINGS_ADMINS_ONLY);
    const settings = await getServicesTeamSettings(ctx.db, ctx.servicesTeam.id);
    // A solo seller keeps the whole price and has no members to pay, whatever preset it starts from.
    const spec = settings?.solo
      ? { ...input.rules, split: { teamCutBps: SOLO_TEAM_CUT_BPS, managerCutBps: 0, memberCutBps: 0 } }
      : input.rules;
    return saveRulebookDraft(ctx.db, {
      teamId: ctx.servicesTeam.id,
      userId: ctx.session.user.id,
      preset: input.preset,
      spec,
    });
  }),

  publish: servicesTeamProcedure.mutation(async ({ ctx }) => {
    requireAction(ctx.servicesTeamRole, "manage_settings", SETTINGS_ADMINS_ONLY);
    return publishRulebook(ctx.db, { teamId: ctx.servicesTeam.id, userId: ctx.session.user.id });
  }),

  acceptMember: servicesTeamProcedure.input(z.strictObject({
    teamSlug: z.string().trim().toLowerCase().min(1).max(63),
    termsAccepted: z.boolean(),
    acceptedRulebookId: z.string().min(1).max(128),
  })).mutation(async ({ ctx, input }) => {
    return acceptMemberRulebook(ctx.db, {
      teamId: ctx.servicesTeam.id,
      userId: ctx.session.user.id,
      termsAccepted: input.termsAccepted,
      acceptedRulebookId: input.acceptedRulebookId,
    });
  }),

  setNoticePreference: servicesTeamProcedure
    .input(z.object({ projectNoticesEnabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      return setMemberNoticePreference(ctx.db, {
        teamId: ctx.servicesTeam.id,
        userId: ctx.session.user.id,
        projectNoticesEnabled: input.projectNoticesEnabled,
      });
    }),

  giveLeavingNotice: servicesTeamProcedure.mutation(async ({ ctx }) => {
    const settings = await getServicesTeamSettings(ctx.db, ctx.servicesTeam.id);
    const state = await getTeamRulebookState(ctx.db, {
      teamId: ctx.servicesTeam.id,
      currency: settings?.currency ?? "USD",
    });
    if (state.published.rules.leavingNotice.days === 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This team's rules set no leaving notice." });
    }
    return giveMemberLeavingNotice(ctx.db, {
      teamId: ctx.servicesTeam.id,
      userId: ctx.session.user.id,
      rulebook: state.published.rules,
    });
  }),
});
