import { FULL_ACCESS } from "@jendal-workspace/core";
import { describe, expect, it } from "vitest";

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
});
