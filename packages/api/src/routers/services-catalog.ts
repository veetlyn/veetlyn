import {
  departmentNameProblem,
  MAX_INTAKE_QUESTION_CHARS,
  MAX_INTAKE_QUESTIONS,
  MAX_OFFERING_DAYS,
  MAX_OFFERING_DESCRIPTION,
  MAX_OFFERING_NAME,
  MAX_OFFERING_PRICE_MINOR,
  normalizeOfferingDraft,
  validateOfferingDraft,
  type OfferingDraft,
} from "@jendal-workspace/core";
import { type Database } from "@jendal-workspace/db";
import {
  createServicesDepartment,
  createServicesOffering,
  deleteServicesDepartment,
  deleteServicesOffering,
  findServicesOffering,
  listServicesDepartments,
  listServicesOfferings,
  renameServicesDepartment,
  setServicesDepartmentListed,
  setServicesOfferingActive,
  updateServicesOffering,
} from "@jendal-workspace/db/repositories/services-catalog";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { router } from "../index";
import { requireAction, servicesTeamProcedure } from "../services-team-procedure";

const ADMIN_ONLY = "Only an admin can manage the catalog.";

const offeringInput = z.object({
  name: z.string().trim().min(1).max(MAX_OFFERING_NAME),
  description: z.string().max(MAX_OFFERING_DESCRIPTION),
  priceMinMinor: z.number().int().min(0).max(MAX_OFFERING_PRICE_MINOR),
  priceMaxMinor: z.number().int().min(0).max(MAX_OFFERING_PRICE_MINOR),
  daysMin: z.number().int().min(1).max(MAX_OFFERING_DAYS),
  daysMax: z.number().int().min(1).max(MAX_OFFERING_DAYS),
  intakeQuestions: z
    .array(z.string().trim().min(1).max(MAX_INTAKE_QUESTION_CHARS))
    .max(MAX_INTAKE_QUESTIONS),
});

// The same rules run in the browser before submit and here as a backstop (sellers design §4.1).
function requireValidOffering(draft: OfferingDraft): void {
  const problem = validateOfferingDraft(draft)[0];
  if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem.message });
}

function draftFrom(input: z.infer<typeof offeringInput>): OfferingDraft {
  return normalizeOfferingDraft({
    name: input.name,
    description: input.description,
    priceMinMinor: input.priceMinMinor,
    priceMaxMinor: input.priceMaxMinor,
    daysMin: input.daysMin,
    daysMax: input.daysMax,
    intakeQuestions: input.intakeQuestions,
  });
}

// A departmentId from the input must belong to the team, so one team cannot reach another's groups.
async function requireDepartment(db: Database, teamId: string, departmentId: string): Promise<void> {
  const departments = await listServicesDepartments(db, teamId);
  if (!departments.some((department) => department.id === departmentId)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "That department is not in your team." });
  }
}

export const servicesCatalogRouter = router({
  list: servicesTeamProcedure.query(async ({ ctx }) => {
    requireAction(ctx.servicesTeamRole, "view_team", "Only team members can view the catalog.");
    const [departments, offerings] = await Promise.all([
      listServicesDepartments(ctx.db, ctx.servicesTeam.id),
      // The team's own list includes inactive services: a paused service is not a deleted one.
      listServicesOfferings(ctx.db, ctx.servicesTeam.id),
    ]);
    return { departments, offerings };
  }),

  createDepartment: servicesTeamProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ ctx, input }) => {
      requireAction(ctx.servicesTeamRole, "manage_settings", ADMIN_ONLY);
      const problem = departmentNameProblem(input.name);
      if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
      const created = await createServicesDepartment(ctx.db, { teamId: ctx.servicesTeam.id, name: input.name });
      if (!created) {
        throw new TRPCError({ code: "CONFLICT", message: "Your team already has a department with this name." });
      }
      return created;
    }),

  renameDepartment: servicesTeamProcedure
    .input(z.object({ departmentId: z.string().min(1), name: z.string() }))
    .mutation(async ({ ctx, input }) => {
      requireAction(ctx.servicesTeamRole, "manage_settings", ADMIN_ONLY);
      const problem = departmentNameProblem(input.name);
      if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
      const renamed = await renameServicesDepartment(ctx.db, {
        id: input.departmentId,
        teamId: ctx.servicesTeam.id,
        name: input.name,
      });
      if (renamed === false) throw new TRPCError({ code: "NOT_FOUND", message: "This department is not in your team." });
      if (renamed === null) {
        throw new TRPCError({ code: "CONFLICT", message: "Your team already has a department with this name." });
      }
      return { departmentId: input.departmentId, name: input.name.trim() };
    }),

  deleteDepartment: servicesTeamProcedure
    .input(z.object({ departmentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireAction(ctx.servicesTeamRole, "manage_settings", ADMIN_ONLY);
      // The offerings keep their rows, with departmentId set to null by the foreign key.
      const deleted = await deleteServicesDepartment(ctx.db, {
        id: input.departmentId,
        teamId: ctx.servicesTeam.id,
      });
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "This department is not in your team." });
      return { departmentId: input.departmentId };
    }),

  // "List in AI assistants" for a whole department: off hides its offerings from the plugin's search.
  setDepartmentListed: servicesTeamProcedure
    .input(z.object({ departmentId: z.string().min(1), listed: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      requireAction(ctx.servicesTeamRole, "manage_settings", ADMIN_ONLY);
      const changed = await setServicesDepartmentListed(ctx.db, {
        id: input.departmentId,
        teamId: ctx.servicesTeam.id,
        listed: input.listed,
      });
      if (!changed) throw new TRPCError({ code: "NOT_FOUND", message: "This department is not in your team." });
      return { departmentId: input.departmentId, listed: input.listed };
    }),

  createOffering: servicesTeamProcedure
    .input(
      offeringInput.extend({
        departmentId: z.string().nullish(),
        listed: z.boolean().default(true),
        fulfilment: z.enum(["people", "automated", "both"]).default("people"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireAction(ctx.servicesTeamRole, "manage_settings", ADMIN_ONLY);
      const draft = draftFrom(input);
      requireValidOffering(draft);
      if (input.departmentId != null) await requireDepartment(ctx.db, ctx.servicesTeam.id, input.departmentId);
      const created = await createServicesOffering(ctx.db, {
        teamId: ctx.servicesTeam.id,
        departmentId: input.departmentId ?? null,
        listed: input.listed,
        fulfilment: input.fulfilment,
        ...draft,
      });
      if (!created) throw new TRPCError({ code: "CONFLICT", message: "Your team already has a service with this name." });
      return created;
    }),

  updateOffering: servicesTeamProcedure
    .input(
      offeringInput.extend({
        offeringId: z.string().min(1),
        departmentId: z.string().nullish(),
        listed: z.boolean().optional(),
        fulfilment: z.enum(["people", "automated", "both"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      requireAction(ctx.servicesTeamRole, "manage_settings", ADMIN_ONLY);
      // The repository cannot tell "not ours" from "name taken" (both null), so check ownership first.
      const found = await findServicesOffering(ctx.db, { id: input.offeringId, teamId: ctx.servicesTeam.id });
      if (!found) throw new TRPCError({ code: "NOT_FOUND", message: "This service is not in your team." });
      const draft = draftFrom(input);
      requireValidOffering(draft);
      if (input.departmentId != null) await requireDepartment(ctx.db, ctx.servicesTeam.id, input.departmentId);
      const updated = await updateServicesOffering(ctx.db, {
        id: input.offeringId,
        teamId: ctx.servicesTeam.id,
        departmentId: input.departmentId ?? null,
        listed: input.listed,
        fulfilment: input.fulfilment,
        ...draft,
      });
      if (!updated) throw new TRPCError({ code: "CONFLICT", message: "Your team already has a service with this name." });
      return updated;
    }),

  setOfferingActive: servicesTeamProcedure
    .input(z.object({ offeringId: z.string().min(1), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      requireAction(ctx.servicesTeamRole, "manage_settings", ADMIN_ONLY);
      const flipped = await setServicesOfferingActive(ctx.db, {
        id: input.offeringId,
        teamId: ctx.servicesTeam.id,
        active: input.active,
      });
      if (!flipped) throw new TRPCError({ code: "NOT_FOUND", message: "This service is not in your team." });
      return { offeringId: input.offeringId, active: input.active };
    }),

  deleteOffering: servicesTeamProcedure
    .input(z.object({ offeringId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireAction(ctx.servicesTeamRole, "manage_settings", ADMIN_ONLY);
      // Projects keep their rows, with offeringId set to null by the foreign key.
      const deleted = await deleteServicesOffering(ctx.db, { id: input.offeringId, teamId: ctx.servicesTeam.id });
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "This service is not in your team." });
      return { offeringId: input.offeringId };
    }),
});
