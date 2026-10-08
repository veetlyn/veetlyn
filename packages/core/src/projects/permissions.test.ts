import { describe, expect, it } from "vitest";

import {
  canAssignFreelancer,
  canProposeAmendment,
  canSeeProject,
  canStartProject,
  canSubmitDelivery,
  quoteAuthor,
  quoteAuthorRefusalMessage,
} from "./permissions";

describe("project permissions", () => {
  it("lets admins and managers start projects and assign freelancers (§4.1)", () => {
    expect([canStartProject("admin"), canStartProject("manager"), canStartProject("freelancer")]).toEqual([true, true, false]);
    expect([canAssignFreelancer("admin"), canAssignFreelancer("manager"), canAssignFreelancer("freelancer")]).toEqual([
      true,
      true,
      false,
    ]);
  });

  describe("quoteAuthor (§4.3 quoting modes)", () => {
    const base = { actorId: "u1", assignedFreelancerId: null };

    it("open: freelancers quote for themselves; staff name the freelancer", () => {
      expect(quoteAuthor({ ...base, role: "freelancer", quotingMode: "open" })).toEqual({ ok: true, freelancerId: "u1" });
      expect(quoteAuthor({ ...base, role: "freelancer", quotingMode: "open", freelancerId: "u2" })).toEqual({
        ok: false,
        reason: "not_allowed",
      });
      expect(quoteAuthor({ ...base, role: "manager", quotingMode: "open", freelancerId: "u2" })).toEqual({
        ok: true,
        freelancerId: "u2",
      });
      expect(quoteAuthor({ ...base, role: "admin", quotingMode: "open" })).toEqual({
        ok: false,
        reason: "freelancer_required",
      });
    });

    it("assigned: only the assigned freelancer quotes", () => {
      expect(quoteAuthor({ ...base, role: "freelancer", quotingMode: "assigned" })).toEqual({ ok: false, reason: "not_assigned" });
      expect(quoteAuthor({ ...base, role: "freelancer", quotingMode: "assigned", assignedFreelancerId: "u1" })).toEqual({
        ok: true,
        freelancerId: "u1",
      });
      expect(quoteAuthor({ ...base, role: "manager", quotingMode: "assigned", assignedFreelancerId: "u2" })).toEqual({
        ok: false,
        reason: "not_allowed",
      });
    });

    it("team: staff quote and name the freelancer", () => {
      expect(quoteAuthor({ ...base, role: "freelancer", quotingMode: "team" })).toEqual({ ok: false, reason: "not_allowed" });
      expect(quoteAuthor({ ...base, role: "manager", quotingMode: "team", freelancerId: "u2" })).toEqual({
        ok: true,
        freelancerId: "u2",
      });
      expect(quoteAuthor({ ...base, role: "manager", quotingMode: "team" })).toEqual({ ok: false, reason: "freelancer_required" });
    });

    it("explains refusals", () => {
      expect(quoteAuthorRefusalMessage("not_assigned")).toBe(
        "Assign a freelancer first; in this team the assigned freelancer quotes.",
      );
    });
  });

  it("lets the assigned freelancer or staff propose amendments (§5.5)", () => {
    expect(canProposeAmendment({ role: "freelancer", actorId: "u1", assignedFreelancerId: "u1" })).toBe(true);
    expect(canProposeAmendment({ role: "freelancer", actorId: "u2", assignedFreelancerId: "u1" })).toBe(false);
    expect(canProposeAmendment({ role: "manager", actorId: "u2", assignedFreelancerId: "u1" })).toBe(true);
  });

  it("shows freelancers their projects and open quoting projects", () => {
    const project = { assignedFreelancerId: "u1", status: "in_progress", quotingMode: "assigned" } as const;
    expect(canSeeProject({ ...project, role: "freelancer", actorId: "u1" })).toBe(true);
    expect(canSeeProject({ ...project, role: "freelancer", actorId: "u2" })).toBe(false);
    expect(canSeeProject({ ...project, role: "manager", actorId: "u2" })).toBe(true);
    expect(
      canSeeProject({ role: "freelancer", actorId: "u2", assignedFreelancerId: null, status: "quoting", quotingMode: "open" }),
    ).toBe(true);
  });
  describe("canSubmitDelivery", () => {
    it("lets the assigned freelancer and staff deliver, and no one else", () => {
      const project = { assignedFreelancerId: "u1" };
      expect(canSubmitDelivery({ role: "freelancer", actorId: "u1", ...project })).toBe(true);
      expect(canSubmitDelivery({ role: "freelancer", actorId: "u2", ...project })).toBe(false);
      expect(canSubmitDelivery({ role: "manager", actorId: "u2", ...project })).toBe(true);
      expect(canSubmitDelivery({ role: "admin", actorId: "u3", ...project })).toBe(true);
    });
  });
});
