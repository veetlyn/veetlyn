import {
  bioProblem,
  hasStoreWideRole,
  MAX_RATE_BPS,
  SERVICES_TEAM_ROLES,
  SOLO_MANAGEMENT_FEE_BPS,
  SOLO_TEAM_CUT_BPS,
  teamSlugProblem,
  validateStoreSlug,
} from "@jendal-workspace/core";
import { countDigitalProducts } from "@jendal-workspace/db/repositories/catalog";
import { createDiscordLinkCode } from "@jendal-workspace/db/repositories/discord";
import { hasTeamPayoutCredentials } from "@jendal-workspace/db/repositories/payout-credentials";
import {
  addServicesTeamMember,
  applySoloTeamDefaults,
  deleteNewServicesTeam,
  findUserByEmail,
  getServicesTeamSettings,
  listOrganizationsWithServicesTeams,
  listServicesTeamMembers,
  saveServicesTeamBio,
  saveServicesTeamSettings,
  setServicesTeamStoreEnabled,
  setServicesTeamMemberRole,
  setServicesTeamMemberTitle,
  switchToTeam as switchTeamToTeamMode,
  workspaceRoleFor,
} from "@jendal-workspace/db/repositories/services-teams";
import { countServicesOfferings } from "@jendal-workspace/db/repositories/services-catalog";
import { isStoreSlugTaken } from "@jendal-workspace/db/repositories/stores";
import { TRPCError } from "@trpc/server";
import { log } from "evlog";
import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { requireAction, servicesTeamProcedure } from "../services-team-procedure";
import { organizationForNewTeam, toTRPCError } from "../team-creation";

const slugInput = z.string().max(100);
const roleInput = z.enum(SERVICES_TEAM_ROLES);

// tRPC has no transformer here, so a Date would reach the browser as a string anyway; make it explicit.
function isoOrNull(date: Date | null): string | null {
  return date?.toISOString() ?? null;
}

export const servicesTeamRouter = router({
  listMine: protectedProcedure.query(async ({ ctx }) => {
    const organizations = await listOrganizationsWithServicesTeams(ctx.db, ctx.session.user.id);
    return organizations.map(({ organization, role, servicesTeams }) => ({
      id: organization.id,
      name: organization.name,
      role,
      servicesTeams: servicesTeams.map(({ team, role: teamRole }) => ({ ...team, role: teamRole })),
    }));
  }),

  // Same organization rule as store.create (services spec §3).
  create: protectedProcedure
    .input(z.object({ name: z.string().trim().min(2).max(80), slug: slugInput, solo: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const slug = validateStoreSlug(input.slug);
      if (!slug.ok) throw new TRPCError({ code: "BAD_REQUEST", message: teamSlugProblem(slug.reason, "services") });
      // Checked before a workspace may be created; the createTeam hook still settles a race.
      if (await isStoreSlugTaken(ctx.db, slug.slug)) {
        throw new TRPCError({ code: "CONFLICT", message: teamSlugProblem("taken", "services") });
      }

      try {
        const organizationId = await organizationForNewTeam(ctx, input.name, { solo: input.solo });
        // createTeam runs the slug and product hooks and creates the default team settings.
        // A solo seller's settings get the solo defaults right after.
        const created = await ctx.auth.api.createTeam({
          body: { name: input.name, organizationId, slug: slug.slug, product: "services" },
          headers: ctx.headers,
        });
        if (input.solo) {
          try {
            await applySoloTeamDefaults(ctx.db, created.id);
          } catch (error) {
            // A half-made solo seller would be a team with team rates; the retry needs its slug back.
            // Better Auth's removeTeam refuses an organization's last team, so the row goes directly.
            // The new organization stays: empty, it is hidden from the workspace home.
            try {
              await deleteNewServicesTeam(ctx.db, created.id);
            } catch (cleanupError) {
              log.error({
                action: "services_team.create_cleanup",
                team: { id: created.id },
                error: { name: cleanupError instanceof Error ? cleanupError.name : "unknown" },
              });
            }
            throw error;
          }
        }
        return { slug: slug.slug };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  get: servicesTeamProcedure.query(async ({ ctx }) => {
    const [settings, offeringCount, productCount, payoutCredentialsSaved] = await Promise.all([
      getServicesTeamSettings(ctx.db, ctx.servicesTeam.id),
      // All offerings count: a draft service still counts as "added" to the checklist.
      countServicesOfferings(ctx.db, ctx.servicesTeam.id),
      // All digital products count, drafts included (same rule as offerings).
      countDigitalProducts(ctx.db, ctx.servicesTeam.id),
      hasTeamPayoutCredentials(ctx.db, ctx.servicesTeam.id),
    ]);
    return {
      team: ctx.servicesTeam,
      role: ctx.servicesTeamRole,
      settings: settings ? { ...settings, settingsSavedAt: isoOrNull(settings.settingsSavedAt) } : null,
      offeringCount,
      productCount,
      payoutCredentialsSaved,
    };
  }),

  // Sellers design §3.2: store_enabled turns the store (digital products) on for a services team.
  setStoreEnabled: servicesTeamProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      requireAction(ctx.servicesTeamRole, "manage_settings", "Only an admin can change the team settings.");
      await setServicesTeamStoreEnabled(ctx.db, ctx.servicesTeam.id, input.enabled);
      return { storeEnabled: input.enabled };
    }),

  updateSettings: servicesTeamProcedure
    .input(
      z.object({
        currency: z.enum(["USD", "EUR"]),
        teamCutBps: z.number().int().min(0).max(MAX_RATE_BPS),
        managementFeeBps: z.number().int().min(0).max(MAX_RATE_BPS),
        quotingMode: z.enum(["open", "assigned", "team"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireAction(ctx.servicesTeamRole, "manage_settings", "Only an admin can change the team settings.");
      const { currency, teamCutBps, managementFeeBps, quotingMode } = input;
      const settings = await getServicesTeamSettings(ctx.db, ctx.servicesTeam.id);
      if (settings?.solo && (teamCutBps !== SOLO_TEAM_CUT_BPS || managementFeeBps !== SOLO_MANAGEMENT_FEE_BPS)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A solo seller keeps the whole price. Switch to a team to set a team cut and a management fee.",
        });
      }
      const saved = await saveServicesTeamSettings(ctx.db, ctx.servicesTeam.id, {
        currency,
        teamCutBps,
        managementFeeBps,
        quotingMode,
      });
      return { ...saved, settingsSavedAt: isoOrNull(saved.settingsSavedAt) };
    }),

  // Sellers design §3.2: the bio is not part of the rates, so it does not mark "Set your rates" done.
  updateBio: servicesTeamProcedure
    .input(z.object({ bio: z.string().max(2_000) }))
    .mutation(async ({ ctx, input }) => {
      requireAction(ctx.servicesTeamRole, "manage_settings", "Only an admin can change the team settings.");
      const problem = bioProblem(input.bio);
      if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
      const bio = input.bio.trim();
      await saveServicesTeamBio(ctx.db, ctx.servicesTeam.id, bio);
      return { bio };
    }),

  // Sellers design §3.1: one-way; a team cannot go back to being a solo seller.
  switchToTeam: servicesTeamProcedure.mutation(async ({ ctx }) => {
    requireAction(ctx.servicesTeamRole, "manage_settings", "Only an admin can change the team settings.");
    const settings = await getServicesTeamSettings(ctx.db, ctx.servicesTeam.id);
    if (settings && !settings.solo) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This seller is already a team." });
    }
    await switchTeamToTeamMode(ctx.db, ctx.servicesTeam.id);
    const switched = await getServicesTeamSettings(ctx.db, ctx.servicesTeam.id);
    return switched ? { ...switched, settingsSavedAt: isoOrNull(switched.settingsSavedAt) } : null;
  }),

  createDiscordLinkCode: servicesTeamProcedure.mutation(async ({ ctx }) => {
    requireAction(ctx.servicesTeamRole, "manage_connections", "Only an admin can link the Discord server.");
    const { code, expiresAt } = await createDiscordLinkCode(ctx.db, ctx.servicesTeam.id);
    return { code, expiresAt: expiresAt.toISOString() };
  }),

  listMembers: servicesTeamProcedure.query(async ({ ctx }) => {
    requireAction(ctx.servicesTeamRole, "view_members", "Only managers and admins can see the member list.");
    return listServicesTeamMembers(ctx.db, ctx.servicesTeam);
  }),

  addMember: servicesTeamProcedure
    .input(z.object({ email: z.string().trim().max(320).pipe(z.email()), role: roleInput }))
    .mutation(async ({ ctx, input }) => {
      requireAction(ctx.servicesTeamRole, "manage_members", "Only an admin can manage members.");
      const settings = await getServicesTeamSettings(ctx.db, ctx.servicesTeam.id);
      if (settings?.solo) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A solo seller has no members. Switch to a team first." });
      }
      const found = await findUserByEmail(ctx.db, input.email);
      if (!found) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No Payleor account uses this email. Ask them to sign up first.",
        });
      }
      const workspaceRole = await workspaceRoleFor(ctx.db, ctx.servicesTeam.organizationId, found.id);
      if (workspaceRole && hasStoreWideRole(workspaceRole)) {
        throw new TRPCError({ code: "CONFLICT", message: "Workspace owners and admins are already team admins." });
      }
      if (!workspaceRole) {
        // The user must be in the workspace before they can hold a team role (services spec §4.1).
        await ctx.auth.api.addMember({
          body: { userId: found.id, organizationId: ctx.servicesTeam.organizationId, role: "member" },
        });
      }
      const inserted = await addServicesTeamMember(ctx.db, {
        teamId: ctx.servicesTeam.id,
        userId: found.id,
        role: input.role,
      });
      if (!inserted) throw new TRPCError({ code: "CONFLICT", message: "This user is already on the team." });
      return { userId: found.id, name: found.name, email: found.email, role: input.role };
    }),

  setMemberRole: servicesTeamProcedure
    .input(z.object({ userId: z.string().min(1), role: roleInput }))
    .mutation(async ({ ctx, input }) => {
      requireAction(ctx.servicesTeamRole, "manage_members", "Only an admin can manage members.");
      const workspaceRole = await workspaceRoleFor(ctx.db, ctx.servicesTeam.organizationId, input.userId);
      if (workspaceRole && hasStoreWideRole(workspaceRole)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A workspace owner or admin keeps the admin role in every services team.",
        });
      }
      const updated = await setServicesTeamMemberRole(ctx.db, {
        teamId: ctx.servicesTeam.id,
        userId: input.userId,
        role: input.role,
      });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "This user is not on the team." });
      return { userId: input.userId, role: input.role };
    }),

  // Sellers design §4.1: a free-text label shown next to the member's name; an empty string clears it.
  setMemberTitle: servicesTeamProcedure
    .input(z.object({ userId: z.string().min(1), title: z.string().trim().max(80) }))
    .mutation(async ({ ctx, input }) => {
      requireAction(ctx.servicesTeamRole, "manage_members", "Only an admin can manage members.");
      const updated = await setServicesTeamMemberTitle(ctx.db, {
        teamId: ctx.servicesTeam.id,
        userId: input.userId,
        title: input.title || null,
      });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "This user is not on the team." });
      return { userId: input.userId, title: input.title || null };
    }),
});
