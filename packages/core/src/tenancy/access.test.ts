import { describe, expect, it } from "vitest";

import { canOpenStore } from "./access";

describe("canOpenStore", () => {
  it("lets organization owners open every store", () => {
    expect(canOpenStore({ role: "owner", isTeamMember: false })).toBe(true);
  });

  it("lets organization admins open every store", () => {
    expect(canOpenStore({ role: "admin", isTeamMember: false })).toBe(true);
  });

  it("reads comma-separated roles", () => {
    expect(canOpenStore({ role: "member, admin", isTeamMember: false })).toBe(true);
  });

  it("keeps other members out of stores whose team they are not in", () => {
    expect(canOpenStore({ role: "member", isTeamMember: false })).toBe(false);
  });

  it("lets other members open stores whose team they are in", () => {
    expect(canOpenStore({ role: "member", isTeamMember: true })).toBe(true);
  });
});
