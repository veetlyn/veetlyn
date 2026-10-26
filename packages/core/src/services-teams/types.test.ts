import { describe, expect, it } from "vitest";

import {
  bioProblem,
  CURRENCIES,
  defaultServicesTeamSettings,
  isCurrency,
  isQuotingMode,
  isServicesTeamRole,
  QUOTING_MODES,
  SERVICES_TEAM_ROLES,
  soloServicesTeamSettings,
} from "./types";

describe("defaultServicesTeamSettings", () => {
  it("defaults a team to a 15% cut and a 10% management fee, not solo, no bio", () => {
    expect(defaultServicesTeamSettings("t1")).toEqual({
      teamId: "t1",
      solo: false,
      kind: "agency",
      managerCutBps: 0,
      storeEnabled: false,
      bio: "",
      currency: "USD",
      teamCutBps: 1_500,
      managementFeeBps: 1_000,
      quotingMode: "assigned",
      settingsSavedAt: null,
      discordGuildId: null,
    });
  });

  it("defaults a solo seller to the whole price (sellers design §3.1)", () => {
    expect(soloServicesTeamSettings("t1")).toEqual({
      ...defaultServicesTeamSettings("t1"),
      solo: true,
      kind: "solo",
      teamCutBps: 10_000,
      managementFeeBps: 0,
    });
  });

  it("keeps a bio under 280 characters", () => {
    expect(bioProblem("  We design logos.  ")).toBeNull();
    expect(bioProblem("x".repeat(280))).toBeNull();
    expect(bioProblem("x".repeat(281))).toBe("Keep your bio under 280 characters.");
  });
});

describe("value guards", () => {
  it("accept only the listed values", () => {
    expect(SERVICES_TEAM_ROLES.every(isServicesTeamRole)).toBe(true);
    expect(isServicesTeamRole("owner")).toBe(false);
    expect(CURRENCIES.every(isCurrency)).toBe(true);
    expect(isCurrency("GBP")).toBe(false);
    expect(QUOTING_MODES.every(isQuotingMode)).toBe(true);
    expect(isQuotingMode("bidding")).toBe(false);
  });
});
