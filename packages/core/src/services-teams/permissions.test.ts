import { describe, expect, it } from "vitest";

import { canServicesTeam, effectiveServicesTeamRole, type ServicesTeamAction } from "./permissions";

const ADMIN_ONLY: ServicesTeamAction[] = [
  "manage_settings",
  "manage_members",
  "manage_connections",
  "manage_developers",
  "approve_payouts",
  "resolve_cases",
];
const MANAGER: ServicesTeamAction[] = [
  "view_team",
  "view_members",
  "start_project",
  "quote_for_team",
  "assign_freelancers",
  "file_case",
];
const FREELANCER: ServicesTeamAction[] = ["view_team", "quote", "deliver", "request_payout", "file_case"];
const NOT_FREELANCER: ServicesTeamAction[] = [
  ...ADMIN_ONLY,
  "view_members",
  "start_project",
  "quote_for_team",
  "assign_freelancers",
];

describe("canServicesTeam", () => {
  it("lets admins do everything a manager does, plus settings, members, connections, payouts and cases", () => {
    for (const action of [...MANAGER, ...ADMIN_ONLY]) expect(canServicesTeam("admin", action)).toBe(true);
  });

  it("lets managers run projects but not change the team", () => {
    for (const action of MANAGER) expect(canServicesTeam("manager", action)).toBe(true);
    for (const action of ADMIN_ONLY) expect(canServicesTeam("manager", action)).toBe(false);
  });

  it("lets freelancers quote, deliver, request payouts and file cases, and nothing else", () => {
    for (const action of FREELANCER) expect(canServicesTeam("freelancer", action)).toBe(true);
    for (const action of NOT_FREELANCER) expect(canServicesTeam("freelancer", action)).toBe(false);
  });

  it("allows nothing without a role", () => {
    expect(canServicesTeam(null, "view_team")).toBe(false);
  });
});

describe("effectiveServicesTeamRole", () => {
  it("makes workspace owners and admins admins of every services team", () => {
    expect(effectiveServicesTeamRole("owner", null)).toBe("admin");
    expect(effectiveServicesTeamRole("admin", "freelancer")).toBe("admin");
    expect(effectiveServicesTeamRole("member, admin", null)).toBe("admin");
  });

  it("uses the team role for other workspace members", () => {
    expect(effectiveServicesTeamRole("member", "manager")).toBe("manager");
    expect(effectiveServicesTeamRole("member", null)).toBeNull();
  });
});
