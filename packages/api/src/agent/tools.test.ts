import { FULL_ACCESS } from "@jendal-workspace/core";
import { describe, expect, it } from "vitest";

import { teamMembers } from "../actions/projects";
import { toolsFor } from "./tools";

const teamNode = {
  seller: { role: { product: "services" as const, role: "admin" as const }, access: FULL_ACCESS },
  workspace: null,
};

describe("toolsFor", () => {
  it("offers assignment and amendment as confirm-first proposals to a team admin", () => {
    const names = toolsFor(teamNode).map((tool) => tool.name);
    expect(names).toContain("propose_project_assign");
    expect(names).toContain("propose_amendment_propose");
    // Deliveries, amendments and ratings are already readable through the project record.
    expect(names).toContain("project_get");
  });

  it("never offers review submission or client rating to the dash assistant", () => {
    const names = toolsFor(teamNode).map((tool) => tool.name);
    expect(names.some((name) => name.includes("review") || name.includes("client_rating"))).toBe(false);
  });

  // Walk 2026-11-10 (staging): asked to assign Moussa, the agent could not find him and asked for a "freelancer ID".
  it("lets every role look up the team's members by name, so an assignment can be proposed", () => {
    for (const role of ["admin", "manager", "freelancer"] as const) {
      const names = toolsFor({ ...teamNode, seller: { ...teamNode.seller, role: { product: "services", role } } }).map((tool) => tool.name);
      expect(names).toContain("team_members");
    }
  });

  it("gives the agent members' names and roles, never their email addresses", () => {
    const parsed = teamMembers.output?.parse([{ id: "u-1", name: "Moussa Fall", role: "freelancer", email: "moussa@example.com" }]);
    expect(parsed).toEqual([{ id: "u-1", name: "Moussa Fall", role: "freelancer" }]);
  });
});
