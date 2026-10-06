import {
  canServicesTeam,
  hasStoreWideRole,
  MAX_RATE_BPS,
  SERVICES_TEAM_ROLES,
  type ServicesTeamRole,
  teamSlugProblem,
  validateStoreSlug,
} from "@jendal-workspace/core";
import { createDiscordLinkCode } from "@jendal-workspace/db/repositories/discord";
import {
  addServicesTeamMember,
  findUserByEmail,
  getServicesTeamSettings,
  listOrganizationsWithServicesTeams,
  listServicesTeamMembers,
  saveServicesTeamSettings,
  setServicesTeamMemberRole,
  workspaceRoleFor,
} from "@jendal-workspace/db/repositories/services-teams";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../index";
import { servicesTeamProcedure } from "../services-team-procedure";
import { organizationForNewTeam, toTRPCError } from "../team-creation";

const slugInput = z.string().max(100);
const roleInput = z.enum(SERVICES_TEAM_ROLES);

// tRPC has no transformer here, so a Date would reach the browser as a string anyway; make it explicit.
function isoOrNull(date: Date | null): string | null {
  return date?.toISOString() ?? null;
}

function requireAction(
  role: ServicesTeamRole,
  action: Parameters<typeof canServicesTeam>[1],
  message: string,
): void {
  if (!canServicesTeam(role, action)) throw new TRPCError({ code: "FORBIDDEN", message });
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
    .input(z.object({ name: z.string().trim().min(2).max(80), slug: slugInput }))
    .mutation(async ({ ctx, input }) => {
      const slug = validateStoreSlug(input.slug);
      if (!slug.ok) throw new TRPCError({ code: "BAD_REQUEST", message: teamSlugProblem(slug.reason, "services") });

      try {
        const organizationId = await organizationForNewTeam(ctx, input.name);
        // createTeam runs the slug and product hooks and creates the default settings (Task 6).
        await ctx.auth.api.createTeam({
          body: { name: input.name, organizationId, slug: slug.slug, product: "services" },
          headers: ctx.headers,
        });
        return { slug: slug.slug };
      } catch (error) {
        throw toTRPCError(error);
      }
    }),

  get: servicesTeamProcedure.query(async ({ ctx }) => {
    const settings = await getServicesTeamSettings(ctx.db, ctx.servicesTeam.id);
    return {
      team: ctx.servicesTeam,
      role: ctx.servicesTeamRole,
      settings: settings ? { ...settings, settingsSavedAt: isoOrNull(settings.settingsSavedAt) } : null,
    };
  }),

  updateSettings: servicesTeamProcedure
    .input(
      z.object({
        currency: z.enum(["USD", "EUR"]),
        teamCutBps: z.number().int().min(0).max(MAX_RATE_BPS),
        managementFeeBps: z.number().int().min(0).max(MAX_RATE_BPS),
        quotingMode: z.enum(["open", "assigned", "team"]),
        payoutMode: z.enum(["manual", "rules", "automatic"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireAction(ctx.servicesTeamRole, "manage_settings", "Only an admin can change the team settings.");
      const { currency, teamCutBps, managementFeeBps, quotingMode, payoutMode } = input;
      const saved = await saveServicesTeamSettings(ctx.db, ctx.servicesTeam.id, {
        currency,
        teamCutBps,
        managementFeeBps,
        quotingMode,
        payoutMode,
      });
      return { ...saved, settingsSavedAt: isoOrNull(saved.settingsSavedAt) };
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
});
