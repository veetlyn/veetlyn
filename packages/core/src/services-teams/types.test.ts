import { describe, expect, it } from "vitest";

import {
  CURRENCIES,
  defaultServicesTeamSettings,
  isCurrency,
  isPayoutMode,
  isQuotingMode,
  isServicesTeamRole,
  PAYOUT_MODES,
  QUOTING_MODES,
  SERVICES_TEAM_ROLES,
} from "./types";

describe("defaultServicesTeamSettings", () => {
  it("starts in USD with a 15% cut, a 10% management fee, assigned quotes and manual payouts", () => {
    expect(defaultServicesTeamSettings("team-1")).toEqual({
      teamId: "team-1",
      currency: "USD",
      teamCutBps: 1500,
      managementFeeBps: 1000,
      quotingMode: "assigned",
      payoutMode: "manual",
      settingsSavedAt: null,
      discordGuildId: null,
    });
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
    expect(PAYOUT_MODES.every(isPayoutMode)).toBe(true);
    expect(isPayoutMode(undefined)).toBe(false);
  });
});
